const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const downloader = require('../utils/downloader');
const extractor = require('../services/extractors'); 

// --- Helper: HTML Formatting ---
const formatHtml = (content, url) => {
    // Identify Platform for the Header
    let platform = 'Social';
    if (url.includes('reddit')) platform = 'Reddit';
    else if (url.includes('x.com') || url.includes('twitter')) platform = 'Twitter';
    else if (url.includes('tiktok')) platform = 'TikTok';
    else if (url.includes('instagram')) platform = 'Instagram';

    // Sanitize Content (Escape HTML special chars to prevent errors)
    const cleanContent = (content || 'Media')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Return the specific layout requested
    return `<b>🎬 ${platform} Media</b> | <a href="${url}">Source</a>\n\n<blockquote>${cleanContent}</blockquote>`;
};

const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const message = ctx.callbackQuery.message;
    
    // 1. Get URL from the message entity
    const url = message.entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Expired or Link not found");

    // 2. INTELLIGENT CAPTION EXTRACTION
    // Goal: Get the text that is CURRENTLY displayed in the message blockquote.
    // This covers both cases: 
    // Case A: User gave Custom Caption -> It's already in the message text.
    // Case B: User gave No Caption -> The Original Title is already in the message text.
    
    let finalCaptionContent = "";

    if (message.text) {
        // The message format is: "Header \n\n Content"
        // We split by double newline to get the content part.
        const parts = message.text.split('\n\n');
        if (parts.length >= 2) {
            // Join back in case the caption itself had newlines
            finalCaptionContent = parts.slice(1).join('\n\n').trim();
        } else {
            // Fallback: Use the whole text if structure is weird, but remove "Source" link text if present
            finalCaptionContent = message.text.replace(/.*Media \| Source/s, '').trim();
        }
    }

    // 3. FAIL-SAFE FALLBACK
    // If for some reason we couldn't get text from the message (empty or bug),
    // we RE-FETCH the original title from the API.
    if (!finalCaptionContent || finalCaptionContent.length < 2) {
        console.log("⚠️ Caption missing in message, re-fetching metadata...");
        try {
            const meta = await extractor.extract(url);
            if (meta && meta.title) {
                finalCaptionContent = meta.title;
            }
        } catch (e) {
            console.error("Metadata fetch failed:", e);
            finalCaptionContent = "Media Content"; // Ultimate fallback
        }
    }

    // Generate the final HTML String
    const finalHtmlCaption = formatHtml(finalCaptionContent, url);

    // --- DOWNLOAD & SEND LOGIC ---

    // A. IMAGE
    if (action === 'img') {
        await ctx.answerCbQuery("🚀 Downloading...");
        const imgPath = path.join(config.DOWNLOAD_DIR, `${Date.now()}.jpg`);
        try {
            await downloader.downloadFile(url, imgPath);
            await ctx.replyWithPhoto({ source: imgPath }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
            await ctx.deleteMessage();
        } catch (e) {
            console.error(e);
            try { await ctx.replyWithDocument(url); } catch {}
        } finally {
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }
    } 
    // B. ALBUM
    else if (action === 'alb') {
        await ctx.answerCbQuery("🚀 Processing...");
        await ctx.editMessageText("⏳ *Fetching Album...*", { parse_mode: 'Markdown' });
        
        // For albums, we need to re-fetch to get the list of items
        const media = await extractor.extract(url);

        if (media?.type === 'gallery') {
            // Send the Caption first as a text message (cleanest for albums)
            await ctx.reply(finalHtmlCaption, { parse_mode: 'HTML', disable_web_page_preview: true });

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
        } else {
            await ctx.editMessageText("❌ Failed.");
        }
    } 
    // C. VIDEO / AUDIO
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
                    await ctx.replyWithAudio({ source: finalFile }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
                } else {
                    // Send Video with the Caption
                    await ctx.replyWithVideo({ source: finalFile }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
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
