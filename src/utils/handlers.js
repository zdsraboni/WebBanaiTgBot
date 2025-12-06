const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings'); // Up one level to src, then config

// Import Local Utils (Same folder now)
const { resolveRedirect } = require('./helpers'); 
const downloader = require('./downloader');

// Import Services (Up one level to src, then services)
const redditService = require('../services/reddit');
const twitterService = require('../services/twitter');

// --- MESSAGE HANDLER ---
const handleMessage = async (ctx) => {
    const match = ctx.message.text.match(config.URL_REGEX);
    if (!match) return;

    console.log(`📩 New Request: ${match[0]}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const inputUrl = match[0];
        const fullUrl = await resolveRedirect(inputUrl);
        let media = null;

        if (fullUrl.includes('x.com') || fullUrl.includes('twitter.com')) {
            media = await twitterService.extract(fullUrl);
        } else {
            media = await redditService.extract(fullUrl);
        }

        if (!media) throw new Error("Media not found");

        // Generate Buttons
        const buttons = [];
        let text = `✅ *${(media.title).substring(0, 50)}...*`;

        if (media.type === 'gallery') {
            text += `\n📚 **Gallery:** ${media.items.length} items`;
            buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        } 
        else if (media.type === 'image') {
            text += `\n🖼 **Image Detected**`;
            buttons.push([Markup.button.callback(`🖼 Download Image`, `img|single`)]);
        } 
        else if (media.type === 'video') {
            if (media.formats && media.formats.length > 0) {
                const formats = media.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height);
                const seen = new Set();
                formats.slice(0, 5).forEach(f => {
                    if(!seen.has(f.height)) {
                        seen.add(f.height);
                        buttons.push([Markup.button.callback(`📹 ${f.height}p`, `vid|${f.format_id}`)]);
                    }
                });
            } else {
                buttons.push([Markup.button.callback("📹 Download Video", `vid|best`)]);
            }
            buttons.push([Markup.button.callback("🎵 Audio Only", "aud|best")]);
        }

        const safeUrl = media.url || media.source; 
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            `${text}\nSource: [Link](${safeUrl})`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

    } catch (e) {
        console.error(`Processing Error: ${e.message}`);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
};

// --- CALLBACK HANDLER ---
const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Link expired.");

    if (action === 'img') {
        await ctx.answerCbQuery("🚀 Sending...");
        try { await ctx.replyWithPhoto(url); } catch { await ctx.replyWithDocument(url); }
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
                    if(item.type==='video') await ctx.replyWithVideo(item.url);
                    else await ctx.replyWithDocument(item.url);
                } catch {}
            }
        }
    }
    else {
        await ctx.answerCbQuery("🚀 Downloading...");
        await ctx.editMessageText(`⏳ *Downloading...*`, { parse_mode: 'Markdown' });
        
        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        const finalFile = `${basePath}.${action === 'aud' ? 'mp3' : 'mp4'}`;

        try {
            console.log(`⬇️ Starting Download: ${url}`);
            await downloader.download(url, action === 'aud', id, basePath);

            const stats = fs.statSync(finalFile);
            if (stats.size > 49.5 * 1024 * 1024) {
                await ctx.editMessageText("⚠️ File > 50MB (Telegram Limit).");
            } else {
                await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
                action === 'aud' 
                    ? await ctx.replyWithAudio({ source: finalFile })
                    : await ctx.replyWithVideo({ source: finalFile });
                await ctx.deleteMessage();
                console.log(`✅ Upload Success: ${url}`);
            }
        } catch (e) {
            console.error(`Download Error: ${e.message}`);
            await ctx.editMessageText("❌ Error during download.");
        } finally {
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
        }
    }
};

module.exports = { handleMessage, handleCallback };