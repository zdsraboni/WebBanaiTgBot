const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const downloader = require('../utils/downloader');
// Note: We need extractor here to get the title again if needed, 
// OR we can pass the title in the button (limited chars) or re-fetch.
// For simplicity and speed, most bots re-fetch light metadata or just send the file.
// BUT since you want the CAPTION on the uploaded file, we need to extract metadata again.
const extractor = require('../services/extractors'); 

// Helper to generate caption (Duplicate code, can be moved to helpers.js if you want strict DRY)
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
    // Extract URL from the message entities (text link)
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url; // For old messages
    // OR try to find url from the message text if entities fail (depends on how messageHandler sends it)
    // Since messageHandler now sends <a href="url">Source</a>, Telegram treats it as entity.
    
    // Fallback if URL finding is tricky with HTML mode:
    // In HTML mode, entities are still parsed. The "Source" link will be the first text_link.
    
    if (!url) return ctx.answerCbQuery("❌ Expired or Link not found");

    // We need to re-fetch metadata to get the Title for the caption
    // (Optimization: In a real large scale app, you might cache this title in a DB/Redis)
    let mediaTitle = "Downloaded Media";
    try {
        const meta = await extractor.extract(url);
        if (meta) mediaTitle = meta.title;
    } catch(e) {}

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
        await ctx.editMessageText("⏳ *Fetching Album...*", { parse_mode: 'Markdown' }); // Status msg doesn't need HTML caption
        
        const media = await extractor.extract(url);

        if (media?.type === 'gallery') {
            await ctx.editMessageText(`📤 *Sending ${media.items.length} items...*`, { parse_mode: 'Markdown' });
            
            // Note: Sending album with caption usually puts caption on the first item
            // But here we are sending items one by one or as a group? 
            // Your previous code sent 1-by-1. Let's stick to that but add caption to the FIRST one or all?
            // Usually caption is annoying on every single item. Let's add it to the first one only OR just send text first.
            
            // Better UX: Send the formatted text first, then the files.
            await ctx.reply(captionText, { parse_mode: 'HTML', disable_web_page_preview: true });

            for (const item of media.items) {
                try {
                    if (item.type === 'video') await ctx.replyWithVideo(item.url);
                    else {
                        const tmpName = path.join(config.DOWNLOAD_DIR, `gal_${Date.now()}_${Math.random()}.jpg`);
                        await downloader.downloadFile(item.url, tmpName);
                        await ctx.replyWithDocument({ source: tmpName }); // Sending as Doc based on your prev code
                        fs.unlinkSync(tmpName);
                    }
                } catch (e) {}
            }
            await ctx.deleteMessage(); // Delete the "Sending..." status
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
