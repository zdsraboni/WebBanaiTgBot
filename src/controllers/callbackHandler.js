const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const downloader = require('../utils/downloader');
const extractor = require('../services/extractors'); 

// --- HELPER: HTML Formatting ---
const formatHtml = (content, url) => {
    let platform = 'Social';
    if (url.includes('reddit')) platform = 'Reddit';
    else if (url.includes('x.com') || url.includes('twitter')) platform = 'Twitter';
    else if (url.includes('tiktok')) platform = 'TikTok';
    else if (url.includes('instagram')) platform = 'Instagram';

    const cleanContent = (content && content.length > 0) ? content.trim() : "Media Content";
    const safeText = cleanContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    return `<b>🎬 ${platform} Media</b> | <a href="${url}">Source</a>\n\n<blockquote>${safeText}</blockquote>`;
};

const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const message = ctx.callbackQuery.message;
    
    const url = message.entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Expired or Link not found");

    let contentText = "";
    if (message.text) {
        const parts = message.text.split('\n\n');
        contentText = parts.length >= 2 ? parts.slice(1).join('\n\n').trim() : message.text.replace(/.*\|\s*Source/i, '').trim();
    }

    if (!contentText) {
        try {
            const meta = await extractor.extract(url);
            if (meta) contentText = meta.title;
        } catch(e) { contentText = "Media Content"; }
    }

    const finalHtmlCaption = formatHtml(contentText, url);

    try {
        await ctx.answerCbQuery("🚀 Processing...");
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);
        
        // --- 🖼️ IMAGE HANDLER (With Fail-safe) ---
        if (action === 'img') {
            const imgPath = `${basePath}.jpg`;
            try {
                await downloader.downloadFile(url, imgPath);
                
                // চেক করুন ফাইলটি তৈরি হয়েছে কি না এবং খালি কি না
                if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size === 0) throw new Error("File empty");

                // প্রথমে ছবি হিসেবে পাঠানোর চেষ্টা
                await ctx.replyWithPhoto({ source: imgPath }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
            } catch (imgErr) {
                console.log("⚠️ Photo fail, sending as document...");
                // ছবি হিসেবে না গেলে ফাইল (Document) হিসেবে পাঠানোর চেষ্টা
                await ctx.replyWithDocument({ source: imgPath }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
            }
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
            await ctx.deleteMessage();
        } 
        
        // --- 📚 ALBUM HANDLER ---
        else if (action === 'alb') {
            await ctx.editMessageText("⏳ <b>Fetching Album...</b>", { parse_mode: 'HTML' });
            const media = await extractor.extract(url);
            if (media?.type === 'gallery') {
                await ctx.reply(finalHtmlCaption, { parse_mode: 'HTML', disable_web_page_preview: true });
                for (const item of media.items) {
                    try {
                        const tmpName = path.join(config.DOWNLOAD_DIR, `gal_${Date.now()}_${Math.random()}.jpg`);
                        await downloader.downloadFile(item.url, tmpName);
                        
                        // অ্যালবাম আইটেমেও Fail-safe ব্যবহার
                        try {
                            if (item.type === 'video') await ctx.replyWithVideo({ source: tmpName });
                            else await ctx.replyWithPhoto({ source: tmpName });
                        } catch (e) {
                            await ctx.replyWithDocument({ source: tmpName });
                        }
                        
                        if (fs.existsSync(tmpName)) fs.unlinkSync(tmpName);
                    } catch (e) {}
                }
                await ctx.deleteMessage();
            }
        } 
        
        // --- 📹 VIDEO / 🎵 AUDIO HANDLER ---
        else {
            const isAudio = action === 'aud';
            const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;
            await ctx.editMessageText(`⏳ <b>Downloading...</b>`, { parse_mode: 'HTML' });

            if (id === 'best' && (url.includes('.mp4') || url.includes('.mp3'))) {
                await downloader.downloadFile(url, finalFile);
            } else {
                await downloader.download(url, isAudio, id, basePath);
            }

            if (fs.existsSync(finalFile) && fs.statSync(finalFile).size > 0) {
                if (fs.statSync(finalFile).size > 49 * 1024 * 1024) {
                    await ctx.editMessageText("⚠️ File > 50MB. Telegram limit.");
                } else {
                    await ctx.editMessageText("📤 <b>Uploading...</b>", { parse_mode: 'HTML' });
                    const method = isAudio ? 'replyWithAudio' : 'replyWithVideo';
                    
                    try {
                        await ctx[method]({ source: finalFile }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
                    } catch (uploadErr) {
                        // ভিডিও আপলোড ফেল করলে ফাইল হিসেবে পাঠানো
                        await ctx.replyWithDocument({ source: finalFile }, { caption: finalHtmlCaption, parse_mode: 'HTML' });
                    }
                    await ctx.deleteMessage();
                }
            } else {
                await ctx.editMessageText("❌ Download failed.");
            }
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
        }

    } catch (e) {
        console.error("Handler Error:", e);
        await ctx.editMessageText(`❌ Error: ${e.message.substring(0, 100)}`);
    }
};

module.exports = { handleCallback };
