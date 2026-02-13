const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Import Version & Config
const { version } = require('./package.json');
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const downloader = require('./src/utils/downloader');

// Import Services
const redditService = require('./src/services/reddit');
const twitterService = require('./src/services/twitter');

logger.init();

const bot = new Telegraf(config.BOT_TOKEN);
const app = express();

if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

// --- HELPERS ---
const resolveRedirect = async (url) => {
    if (!url.includes('/s/')) return url;
    try {
        const res = await axios.head(url, { maxRedirects: 0, validateStatus: s => s >= 300 && s < 400, headers: { 'User-Agent': config.UA_ANDROID } });
        return res.headers.location || url;
    } catch (e) { return url; }
};

// HTML স্পেশাল ক্যারেক্টার ফিল্টার করার ফাংশন (এরর এড়াতে)
const escapeHTML = (text) => {
    return text ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : "";
};

// --- HANDLER: MESSAGE ---
bot.start((ctx) => ctx.reply(`👋 **Media Banai Bot v${version}**\n\nলিংক এবং এরপর আপনার ক্যাপশন লিখে পাঠাতে পারেন।`));

bot.on('text', async (ctx) => {
    const fullText = ctx.message.text;
    const match = fullText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    // ১. ইউজার ক্যাপশন না দিলে "null" স্ট্রিং সেট হবে
    const userCustomCaption = fullText.replace(inputUrl, '').trim() || "null";

    console.log(`📩 New Request: ${inputUrl}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(inputUrl);
        let media = null;

        if (fullUrl.includes('x.com') || fullUrl.includes('twitter.com')) {
            media = await twitterService.extract(fullUrl);
        } else {
            media = await redditService.extract(fullUrl);
        }

        if (!media) throw new Error("Media not found");

        // ২. ডাইনামিক ক্যাপশন লজিক ("null" কন্ডিশন)
        let finalCaptionText;
        if (userCustomCaption === "null") {
            // যদি কাস্টম ক্যাপশন না থাকে, পোস্টের টাইটেল ব্যবহার হবে
            finalCaptionText = media.title || "Uploaded ✅";
        } else {
            // ইউজার যা লিখেছে সেটাই থাকবে
            finalCaptionText = userCustomCaption;
        }

        // ৩. UI ডিজাইন: Quote ব্লকের ভেতরে ক্যাপশন সাজানো
        const safeCaption = escapeHTML(finalCaptionText);
        const htmlLayout = `<b>🎬 Media Content</b>\n\n<blockquote>${safeCaption}</blockquote>`;

        const buttons = [];
        if (media.type === 'gallery') {
            buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        } 
        else if (media.type === 'image') {
            buttons.push([Markup.button.callback(`🖼 Download Image`, `img|single`)]);
        } 
        else if (media.type === 'video') {
            if (media.formats && media.formats.length > 0) {
                const formats = media.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height).slice(0, 5);
                formats.forEach(f => {
                    if(!buttons.some(b => b[0].text.includes(f.height))) 
                        buttons.push([Markup.button.callback(`📹 ${f.height}p`, `vid|${f.format_id}`)]);
                });
            }
            if (buttons.length === 0) buttons.push([Markup.button.callback("📹 Download Video", `vid|best`)]);
            buttons.push([Markup.button.callback("🎵 Audio Only", "aud|best")]);
        }

        // এনালাইজিং মেসেজ আপডেট (parse_mode HTML করা হয়েছে)
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, 
            `${htmlLayout}\n\n<a href="${media.url || media.source}">🔗 Source Link</a>\n\n📝 Caption: ${finalCaptionText}`, 
            { parse_mode: 'HTML', disable_web_page_preview: true, ...Markup.inlineKeyboard(buttons) }
        );

    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
});

// --- HANDLER: CALLBACKS ---
bot.on('callback_query', async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const messageText = ctx.callbackQuery.message.text || "";
    
    // ৪. সোর্স লিংক এবং ক্যাপশন ডাটা রিকভারি
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    const captionMatch = messageText.match(/📝 Caption: (.*)/s);
    const finalCaption = captionMatch ? captionMatch[1] : "Uploaded ✅";
    
    // মিডিয়ার জন্য Quote UI ডিজাইন
    const finalUI = `<blockquote>${escapeHTML(finalCaption)}</blockquote>`;

    if (!url) return ctx.answerCbQuery("❌ Expired");

    if (action === 'img') {
        const sent = await ctx.replyWithPhoto(url, { caption: finalUI, parse_mode: 'HTML' });
        if(!sent) await ctx.replyWithDocument(url, { caption: finalUI, parse_mode: 'HTML' });
        await ctx.deleteMessage();
    } 
    else if (action === 'alb') {
        await ctx.answerCbQuery("🚀 Processing...");
        let media = null;
        if (url.includes('x.com') || url.includes('twitter')) media = await twitterService.extract(url);
        else media = await redditService.extract(url);

        if (media?.type === 'gallery') {
            await ctx.deleteMessage();
            for (const item of media.items) {
                try { 
                    if(item.type==='video') 
                        await ctx.replyWithVideo(item.url, { caption: finalUI, parse_mode: 'HTML' }); 
                    else 
                        await ctx.replyWithDocument(item.url, { caption: finalUI, parse_mode: 'HTML' }); 
                } catch {}
            }
        }
    } 
    else {
        await ctx.answerCbQuery("🚀 Downloading...");
        await ctx.editMessageText(`⏳ <b>Downloading...</b>`, { parse_mode: 'HTML' });
        
        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        const isAudio = action === 'aud';
        const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;

        try {
            await downloader.download(url, isAudio, id, basePath);
            await ctx.editMessageText("📤 <b>Uploading...</b>", { parse_mode: 'HTML' });
            
            if (isAudio) 
                await ctx.replyWithAudio({ source: finalFile }, { caption: finalUI, parse_mode: 'HTML' });
            else 
                await ctx.replyWithVideo({ source: finalFile }, { caption: finalUI, parse_mode: 'HTML' });
            
            await ctx.deleteMessage();
        } catch (e) { 
            console.error(e); 
            await ctx.editMessageText("❌ Error"); 
        } finally { 
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile); 
        }
    }
});

// --- SERVER ---
if (process.env.NODE_ENV === 'production') {
    app.use(bot.webhookCallback('/bot'));
    bot.telegram.setWebhook(`${config.APP_URL}/bot`);
    app.listen(config.PORT, '0.0.0.0', () => console.log(`🚀 Server on ${config.PORT}`));
} else { 
    bot.launch(); 
    console.log("🚀 Bot is Polling...");
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
