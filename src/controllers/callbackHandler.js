const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const downloader = require('../utils/downloader');
const extractor = require('../services/extractors'); 

const generateCaption = (text, platform, sourceUrl) => {
    const safeText = (text || "Media").replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<b>🎬 ${platform} Media</b> | <a href="${sourceUrl}">Source</a>\n\n<blockquote>${safeText}</blockquote>`;
};

const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const message = ctx.callbackQuery.message;
    const url = (message.entities || message.caption_entities)?.find(e => e.type === 'text_link')?.url;
    
    if (!url) return ctx.answerCbQuery("❌ Link not found");

    let platform = url.includes('reddit') ? 'Reddit' : (url.includes('tiktok') ? 'TikTok' : (url.includes('instagram') ? 'Instagram' : 'Twitter'));
    
    // Extracting text from caption or text body
    let rawText = message.caption || message.text || "";
    let contentText = rawText.split('\n\n').length >= 2 ? rawText.split('\n\n').slice(1).join('\n\n').trim() : rawText.replace(/.*Source/i, '').trim();

    if (!contentText) {
        try { const meta = await extractor.extract(url); contentText = meta.title; } catch(e) { contentText = "Media Content"; }
    }

    const finalHtmlCaption = generateCaption(contentText, platform, url);

    try {
        await ctx.answerCbQuery("🚀 Downloading...");
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);

        if (action === 'img') {
            const imgPath = `${basePath}.jpg`;
            await downloader.downloadFile(url, imgPath);
            try {
                // Priority: Send as Photo
                await ctx.replyWithPhoto({ source: imgPath }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
            } catch (e) {
                // Fallback: Send as Document only if photo fails
                await ctx.replyWithDocument({ source: imgPath }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
            }
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
            await ctx.deleteMessage().catch(()=>{});
        } 
        else if (action === 'alb') {
            await ctx.editMessageCaption(ctx.chat.id, message.message_id, null, "⏳ <b>Fetching...</b>", { parse_mode: 'HTML' }).catch(async () => {
                await ctx.editMessageText("⏳ <b>Fetching...</b>", { parse_mode: 'HTML' });
            });
            const media = await extractor.extract(url);
            if (media?.type === 'gallery') {
                await ctx.reply(finalHtmlCaption, { parse_mode: 'HTML', disable_web_page_preview: true });
                for (const item of media.items) {
                    const tmp = path.join(config.DOWNLOAD_DIR, `gal_${Date.now()}.jpg`);
                    await downloader.downloadFile(item.url, tmp);
                    try {
                        if (item.type === 'video') await ctx.replyWithVideo({ source: tmp });
                        else await ctx.replyWithPhoto({ source: tmp });
                    } catch (e) { await ctx.replyWithDocument({ source: tmp }); }
                    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
                }
                await ctx.deleteMessage().catch(()=>{});
            }
        } 
        else {
            const isAudio = action === 'aud';
            const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;
            
            // Updating status without removing the caption if possible
            try { await ctx.editMessageCaption(ctx.chat.id, message.message_id, null, "⏳ <b>Downloading...</b>", { parse_mode: 'HTML' }); } catch(e) {}

            await downloader.download(url, isAudio, id, basePath);
            
            if (fs.existsSync(finalFile)) {
                await ctx.editMessageCaption(ctx.chat.id, message.message_id, null, "📤 <b>Uploading...</b>", { parse_mode: 'HTML' }).catch(()=>{});
                const method = isAudio ? 'replyWithAudio' : 'replyWithVideo';
                await ctx[method]({ source: finalFile }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
                await ctx.deleteMessage().catch(()=>{});
                fs.unlinkSync(finalFile);
            }
        }
    } catch (e) {
        console.error(e);
        await ctx.reply("❌ Error occurred.");
    }
};

module.exports = { handleCallback };
