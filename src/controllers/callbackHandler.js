const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const downloader = require('../utils/downloader');
const extractor = require('../services/extractors'); 

// --- Helper: Caption Generator for File Upload ---
const getCaption = (title, url) => {
    let platform = 'Social';
    if (url.includes('reddit')) platform = 'Reddit';
    else if (url.includes('x.com') || url.includes('twitter')) platform = 'Twitter';
    else if (url.includes('tiktok')) platform = 'TikTok';
    else if (url.includes('instagram')) platform = 'Instagram';

    const cleanTitle = (title || 'Media')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    return `<b>🎬 ${platform} Media</b> | <a href="${url}">Source</a>\n\n<blockquote>${cleanTitle}</blockquote>`;
};

const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const message = ctx.callbackQuery.message;
    
    // 1. Get URL safely
    // Note: In HTML mode, entities are parsed differently, but text_link usually remains.
    const url = message.entities?.find(e => e.type === 'text_link')?.url;
    
    if (!url) return ctx.answerCbQuery("❌ Expired or Link not found");

    // 2. Extract Logic: Try to get the Custom Caption from the existing message
    // This preserves what the user typed (or the original title if they didn't type anything).
    let mediaTitle = null;
    
    if (message.text) {
        // We know our format has specific lines.
        // Usually the text inside blockquote is at the end.
        // Simple logic: Take the text, split by newline, take the last part.
        // Or cleaner: Since we constructed it, we can reuse it.
        // BUT Telegram doesn't give us "blockquote" in raw text easily via API in all libs.
        // Fallback: Use the whole text minus the header?
        // Let's rely on Re-Extraction if parsing fails, OR trust the text structure.
        
        // Heuristic: If there is a double newline, the caption is likely after it.
        const parts = message.text.split('\n\n');
        if (parts.length > 1) {
            mediaTitle = parts[parts.length - 1].trim(); 
        } else {
             mediaTitle = message.text; // Fallback
        }
    }

    // Fallback: If we couldn't parse the message text properly, re-fetch metadata
    if (!mediaTitle || mediaTitle.includes('Media | Source')) {
        try {
            const meta = await extractor.extract(url);
            if (meta) mediaTitle = meta.title;
        } catch(e) {}
    }

    const captionText = getCaption(mediaTitle, url);

    // --- IMAGE ---
    if (action === 'img') {
        await ctx.answerCbQuery("🚀 Downloading...");
        const imgPath = path.join(config.DOWNLOAD_DIR, `${Date.now()}.jpg`);
        try {
            await downloader.downloadFile(url, imgPath);
            await ctx.replyWithPhoto({ source: imgPath }, { caption: captionText, parse_mode: 'HTML' });
            await ctx.deleteMessage();
        } catch (e) {
            try { await ctx.replyWithDocument(url); } catch {}
        } finally {
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }
    } 
    // --- ALBUM ---
    else if (action === 'alb') {
        await ctx.answerCbQuery("🚀 Processing...");
        await ctx.editMessageText("⏳ *Fetching Album...*", { parse_mode: 'Markdown' });
        
        const media = await extractor.extract(url); // Need to re-fetch to get items list

        if (media?.type === 'gallery') {
            // Send Caption first as text
            await ctx.reply(captionText, { parse_mode: 'HTML', disable_web_page_preview: true });

            for (const item of media.items) {
                try {
                    if (item.type === 'video') await ctx.replyWithVideo(item.url);
                    else {
                        const tmpName = path.join(config.DOWNLOAD_DIR, `gal_${Date.now()}_${Math.random()}.jpg`);
                        await downloader.downloadFile(item.url, tmpName);
                        await ctx.replyWithDocument({ source: tmpName });
                        fs.unlinkSync(tmpName);
                    }
                } catch (e) {}
            }
            await ctx.deleteMessage();
        } else {
            await ctx.editMessageText("❌ Failed.");
        }
    } 
    // --- VIDEO ---
    else {
        await ctx.answerCbQuery("🚀 Downloading...");
        await ctx.editMessageText(`⏳ *Downloading...*`, { parse_mode: 'Markdown' });
        
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);
        const isAudio = action === 'aud';
        const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;

        try {
            if (id === 'best' && (url.includes('.mp4') || url.includes('.mp3'))) {
                await downloader.downloadFile(url, finalFile);
            } else {
                await downloader.download(url, isAudio, id, basePath);
            }

            const stats = fs.statSync(finalFile);
            if (stats.size > 49.5 * 1024 * 1024) await ctx.editMessageText("⚠️ File > 50MB");
            else {
                await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
                
                if (isAudio) {
                    await ctx.replyWithAudio({ source: finalFile }, { caption: captionText, parse_mode: 'HTML' });
                } else {
                    await ctx.replyWithVideo({ source: finalFile }, { caption: captionText, parse_mode: 'HTML' });
                }
                
                await ctx.deleteMessage();
            }
        } catch (e) {
            console.error("DL Error:", e);
            await ctx.editMessageText("❌ Error.");
        } finally {
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
        }
    }
};

module.exports = { handleCallback };
