const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ভার্সন এবং কনফিগ ইমপোর্ট
const { version } = require('./package.json');
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const downloader = require('./src/utils/downloader');

// সার্ভিস ইমপোর্ট
const redditService = require('./src/services/reddit');
const twitterService = require('./src/services/twitter');

logger.init();

const bot = new Telegraf(config.BOT_TOKEN);
const app = express();

// ডাউনলোড ডিরেক্টরি চেক
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

// রিডাইরেক্ট ইউআরএল হ্যান্ডলার
const resolveRedirect = async (url) => {
    if (!url.includes('/s/')) return url;
    try {
        const res = await axios.head(url, { maxRedirects: 0, validateStatus: s => s >= 300 && s < 400, headers: { 'User-Agent': config.UA_ANDROID } });
        return res.headers.location || url;
    } catch (e) { return url; }
};

// --- হ্যান্ডলার: নতুন মেসেজ ---
bot.start((ctx) => ctx.reply(`👋 **Media Banai Bot v${version}**\n\nলিংক এবং এরপর স্পেস দিয়ে আপনার পছন্দের ক্যাপশন লিখুন (ঐচ্ছিক)।`));

bot.on('text', async (ctx) => {
    const fullText = ctx.message.text;
    const match = fullText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    
    // ১. কাস্টম ক্যাপশন আলাদা করা (না থাকলে "null" সেট করা)
    const userCustomCaption = fullText.replace(inputUrl, '').trim() || "null";

    console.log(`📩 New Request: ${inputUrl}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(inputUrl);
        let media = null;

        // প্ল্যাটফর্ম অনুযায়ী ডাটা সংগ্রহ
        if (fullUrl.includes('x.com') || fullUrl.includes('twitter.com')) {
            media = await twitterService.extract(fullUrl);
        } else {
            media = await redditService.extract(fullUrl);
        }

        if (!media) throw new Error("Media not found");

        // --- ২. কন্ডিশনাল ক্যাপশন লজিক ---
        let finalDisplayCaption;
        if (userCustomCaption === "null") {
            // যদি ইউজার ক্যাপশন না দেয়, তবে পোস্টের আসল টাইটেল ব্যবহার হবে
            finalDisplayCaption = media.title || "Uploaded ✅";
        } else {
            // ইউজার যা লিখেছে সেটিই থাকবে
            finalDisplayCaption = userCustomCaption;
        }

        const buttons = [];
        let text = `✅ *${(media.title || "Media").substring(0, 50)}...*`;

        // বাটন জেনারেশন
        if (media.type === 'gallery') {
            text += `\n📚 **Gallery:** ${media.items.length} items`;
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

        // ৩. মেসেজে ক্যাপশনটি লুকিয়ে রাখা (📝 Caption: ট্যাগ দিয়ে)
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, 
            `${text}\n\n[🔗 Source](${media.url || media.source})\n\n📝 *Caption:* ${finalDisplayCaption}`, 
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
});

// --- হ্যান্ডলার: বাটন ক্লিক (Callbacks) ---
bot.on('callback_query', async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const messageText = ctx.callbackQuery.message.text || "";
    
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    
    // ৪. আগের মেসেজ থেকে ক্যাপশন উদ্ধার
    const captionMatch = messageText.match(/📝 Caption: (.*)/s);
    const finalCaption = captionMatch ? captionMatch[1] : "Uploaded ✅";

    if (!url) return ctx.answerCbQuery("❌ Expired");

    if (action === 'img') {
        const sent = await ctx.replyWithPhoto(url, { caption: finalCaption });
        if(!sent) await ctx.replyWithDocument(url, { caption: finalCaption });
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
                        await ctx.replyWithVideo(item.url, { caption: finalCaption }); 
                    else 
                        await ctx.replyWithDocument(item.url, { caption: finalCaption }); 
                } catch {}
            }
        }
    } 
    else {
        await ctx.answerCbQuery("🚀 Downloading...");
        await ctx.editMessageText(`⏳ *Downloading...*`, { parse_mode: 'Markdown' });
        
        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        const isAudio = action === 'aud';
        const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;

        try {
            await downloader.download(url, isAudio, id, basePath);
            await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
            
            if (isAudio) 
                await ctx.replyWithAudio({ source: finalFile }, { caption: finalCaption });
            else 
                await ctx.replyWithVideo({ source: finalFile }, { caption: finalCaption });
            
            await ctx.deleteMessage();
        } catch (e) { 
            console.error(e); 
            await ctx.editMessageText("❌ Error"); 
        } finally { 
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile); 
        }
    }
});

// --- সার্ভার স্টার্ট ---
if (process.env.NODE_ENV === 'production') {
    app.use(bot.webhookCallback('/bot'));
    bot.telegram.setWebhook(`${config.APP_URL}/bot`);
    app.listen(config.PORT, '0.0.0.0', () => console.log(`🚀 Server running on ${config.PORT}`));
} else { 
    bot.launch(); 
    console.log("🚀 Bot started in Polling mode");
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
