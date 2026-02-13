const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const downloader = require('../utils/downloader');
const extractor = require('../services/extractors'); 

// --- HELPER: Same Caption Generator to keep consistency ---
const generateCaption = (text, platform, sourceUrl) => {
    const cleanText = text ? text.trim() : "Media Content";
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<b>🎬 ${platform} Media</b> | <a href="${sourceUrl}">Source</a>\n\n<blockquote>${safeText}</blockquote>`;
};

const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const message = ctx.callbackQuery.message;
    
    const url = message.entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Expired or Link not found");

    // ============================================================
    // 🧠 SMART CAPTION RECOVERY (Based on your idea)
    // ============================================================
    let contentText = "";
    let platform = "Social";

    // 1. Identify Platform
    if (url.includes('reddit')) platform = 'Reddit';
    else if (url.includes('x.com') || url.includes('twitter')) platform = 'Twitter';
    else if (url.includes('tiktok')) platform = 'TikTok';
    else if (url.includes('instagram')) platform = 'Instagram';

    // 2. Extract Logic
    // The message currently looks like: "🎬 Platform Media | Source \n\n Blockquote Content"
    // We want the "Blockquote Content" part.
    if (message.text) {
        const parts = message.text.split('\n\n');
        if (parts.length >= 2) {
            // Take the last part (Content)
            contentText = parts.slice(1).join('\n\n').trim();
        } else {
            // Fallback
            contentText = message.text.replace(/.*Source/s, '').trim();
        }
    }

    // 3. Fallback: If extraction failed (empty), fetch from API
    if (!contentText || contentText.length < 2) {
        try {
            const meta = await extractor.extract(url);
            if (meta) contentText = meta.title;
        } catch(e) {}
    }

    // 4. Re-generate HTML
    const finalHtmlCaption = generateCaption(contentText, platform, url);

    // ============================================================
    // ⬇️ DOWNLOAD & SEND
    // ============================================================

    try {
        await ctx.answerCbQuery("🚀 Downloading...");
        
        // Only show status update if it's taking time, but don't lose caption in "edit" if possible.
        // Actually, editing caption to "Downloading..." kills the old text.
        // Better UX: Send a "Toast" notification (answerCbQuery) and maybe edit ONLY if slow.
        // Let's keep it simple: Just download.
        
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);
        
        // --- IMAGE ---
        if (action === 'img') {
            const imgPath = `${basePath}.jpg`;
            await downloader.downloadFile(url, imgPath);
            await ctx.replyWithPhoto({ source: imgPath }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
            fs.unlinkSync(imgPath);
            await ctx.deleteMessage();
        } 
        
        // --- ALBUM ---
        else if (action === 'alb') {
            await ctx.editMessageText("⏳ *Fetching Album...*", { parse_mode: 'Markdown' });
            const media = await extractor.extract(url);
            if (media?.type === 'gallery') {
                // Send Caption First
                await ctx.reply(finalHtmlCaption, { parse_mode: 'HTML', disable_web_page_preview: true });
                // Send Items
                for (const item of media.items) {
                    try {
                        const tmpName = path.join(config.DOWNLOAD_DIR, `gal_${Date.now()}_${Math.random()}.jpg`);
                        await downloader.downloadFile(item.url, tmpName);
                        if (item.type === 'video') await ctx.replyWithVideo({ source: tmpName });
                        else await ctx.replyWithDocument({ source: tmpName });
                        fs.unlinkSync(tmpName);
                    } catch (e) {}
                }
                await ctx.deleteMessage();
            }
        } 
        
        // --- VIDEO / AUDIO ---
        else {
            const isAudio = action === 'aud';
            const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;
            
            // Edit message to show progress
            await ctx.editMessageText(`⏳ <b>Downloading...</b>`, { parse_mode: 'HTML' });

            if (id === 'best' && (url.includes('.mp4') || url.includes('.mp3'))) {
                await downloader.downloadFile(url, finalFile);
            } else {
                await downloader.download(url, isAudio, id, basePath);
            }

            const stats = fs.statSync(finalFile);
            if (stats.size > 49.5 * 1024 * 1024) {
                await ctx.editMessageText("⚠️ File > 50MB. Cannot upload via Bot API.");
            } else {
                await ctx.editMessageText("📤 <b>Uploading...</b>", { parse_mode: 'HTML' });
                
                const method = isAudio ? 'replyWithAudio' : 'replyWithVideo';
                await ctx[method]({ source: finalFile }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
                
                await ctx.deleteMessage(); // Delete the "Uploading..." status message
            }
            
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
        }

    } catch (e) {
        console.error("Handler Error:", e);
        await ctx.editMessageText("❌ Error: " + e.message);
    }
};

module.exports = { handleCallback };
