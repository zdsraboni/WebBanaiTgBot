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
    // প্রিভিউ মেসেজের ক্যাপশন বা টেক্সট থেকে সোর্স লিংক খুঁজে নেওয়া
    const url = (message.entities || message.caption_entities)?.find(e => e.type === 'text_link')?.url;
    
    if (!url) return ctx.answerCbQuery("❌ Link not found");

    let platform = url.includes('reddit') ? 'Reddit' : (url.includes('tiktok') ? 'TikTok' : (url.includes('instagram') ? 'Instagram' : 'Twitter'));
    
    // আগের প্রিভিউ মেসেজ থেকে ক্যাপশনটি কপি করা
    let rawText = message.caption || message.text || "";
    let contentText = rawText.split('\n\n').length >= 2 ? rawText.split('\n\n').slice(1).join('\n\n').trim() : rawText.replace(/.*Source/i, '').trim();

    if (!contentText) {
        try { const meta = await extractor.extract(url); contentText = meta.title; } catch(e) { contentText = "Media Content"; }
    }

    const finalHtmlCaption = generateCaption(contentText, platform, url);

    try {
        await ctx.answerCbQuery("🚀 Downloading...");
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);

        // --- ইমেজ সরাসরি ছবি হিসেবে পাঠানোর লজিক ---
        if (action === 'img') {
            const imgPath = `${basePath}.jpg`;
            await downloader.downloadFile(url, imgPath);
            try {
                // সরাসরি ফটো হিসেবে রিপ্লাই দেওয়া
                await ctx.replyWithPhoto({ source: imgPath }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
            } catch (e) {
                // যদি ফটো মেথড ফেল করে তবেই ফাইল হিসেবে পাঠাবে
                await ctx.replyWithDocument({ source: imgPath }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
            }
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
            await ctx.deleteMessage().catch(()=>{});
        } 
        else if (action === 'alb') {
            try {
                await ctx.editMessageCaption(ctx.chat.id, message.message_id, null, "⏳ <b>Fetching...</b>", { parse_mode: 'HTML' });
            } catch(e) {
                await ctx.editMessageText("⏳ <b>Fetching...</b>", { parse_mode: 'HTML' });
            }
            
            const media = await extractor.extract(url);
            if (media?.type === 'gallery') {
                await ctx.reply(finalHtmlCaption, { parse_mode: 'HTML', disable_web_page_preview: true });
                for (const item of media.items) {
                    const tmp = path.join(config.DOWNLOAD_DIR, `gal_${Date.now()}.jpg`);
                    await downloader.downloadFile(item.url, tmp);
                    try {
                        if (item.type === 'video') await ctx.replyWithVideo({ source: tmp });
                        else await ctx.replyWithPhoto({ source: tmp }); // অ্যালবামের ছবিগুলোও সরাসরি ছবি হিসেবে যাবে
                    } catch (e) { await ctx.replyWithDocument({ source: tmp }); }
                    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
                }
                await ctx.deleteMessage().catch(()=>{});
            }
        } 
        else {
            const isAudio = action === 'aud';
            const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;
            
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
