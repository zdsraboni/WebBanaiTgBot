const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Import Version
const { version } = require('./package.json');

// Import Modules
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

const resolveRedirect = async (url) => {
    if (!url.includes('/s/')) return url;
    try {
        const res = await axios.head(url, { maxRedirects: 0, validateStatus: s => s >= 300 && s < 400, headers: { 'User-Agent': config.UA_ANDROID } });
        return res.headers.location || url;
    } catch (e) { return url; }
};

// --- HANDLER ---
bot.start((ctx) => ctx.reply(`👋 **Media Banai Bot v${version}**\n\nStable Mode.\nSend: [Link] [Custom Caption]`));

bot.on('text', async (ctx) => {
    const fullText = ctx.message.text;
    const match = fullText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    // <--- পরিবর্তন: লিংক বাদে বাকি টেক্সটকে ক্যাপশন হিসেবে ধরা হচ্ছে --->
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

        const buttons = [];
        let text = `✅ *${(media.title).substring(0, 50)}...*`;

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

        // <--- পরিবর্তন: মেসেজের নিচে 'Caption: ...' হিসেবে ইউজারের টেক্সট রাখা হচ্ছে যেন বট পরে এটা পড়তে পারে --->
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, 
            `${text}\n\n[🔗 Source](${media.url || media.source})\n\n📝 *Caption:* ${userCustomCaption}`, 
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
});

// --- CALLBACKS ---
bot.on('callback_query', async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const messageText = ctx.callbackQuery.message.text || "";
    
    // <--- পরিবর্তন: আগের মেসেজ থেকে সোর্স লিংক এবং কাস্টম ক্যাপশন বের করা হচ্ছে --->
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    const captionMatch = messageText.match(/📝 Caption: (.*)/s);
    const finalCaption = captionMatch ? captionMatch[1] : "null";

    if (!url) return ctx.answerCbQuery("❌ Expired");

    if (action === 'img') {
        // <--- পরিবর্তন: ডাইনামিক ক্যাপশন ব্যবহার --->
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
                        await ctx.replyWithVideo(item.url, { caption: finalCaption }); // ডাইনামিক ক্যাপশন
                    else 
                        await ctx.replyWithDocument(item.url, { caption: finalCaption }); // ডাইনামিক ক্যাপশন
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
                await ctx.replyWithAudio({ source: finalFile }, { caption: finalCaption }); // ডাইনামিক ক্যাপশন
            else 
                await ctx.replyWithVideo({ source: finalFile }, { caption: finalCaption }); // ডাইনামিক ক্যাপশন
            
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
} else { bot.launch(); }

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
