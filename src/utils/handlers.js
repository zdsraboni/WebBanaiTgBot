const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');

const { resolveRedirect } = require('./helpers'); 
const downloader = require('./downloader');
const redditService = require('../services/reddit');
const twitterService = require('../services/twitter');

// --- HELPER: GENERATE NEW UI CAPTION ---
// This function creates the exact UI style from your screenshot
const generateCaption = (title, platform, sourceUrl) => {
    // Truncate title to keep it clean
    const cleanTitle = title.length > 200 ? title.substring(0, 197) + '...' : title;
    // Escape HTML special characters
    const safeTitle = cleanTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // THE NEW UI TEMPLATE
    // 🎬 platform media | source
    // > blockquote title
    return `🎬 <b>${platform} media</b> | <a href="${sourceUrl}">source</a>\n\n<blockquote>${safeTitle}</blockquote>`;
};

// --- SHARED DOWNLOAD FUNCTION ---
const performDownload = async (ctx, url, isAudio, qualityId, messageIdToEdit, captionText) => {
    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id, messageIdToEdit, null, 
            `⏳ *Downloading...*\n_Creating your masterpiece..._`, 
            { parse_mode: 'Markdown' }
        );

        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;

        console.log(`⬇️ Starting Download: ${url}`);
        await downloader.download(url, isAudio, qualityId, basePath);

        const stats = fs.statSync(finalFile);
        if (stats.size > 49.5 * 1024 * 1024) {
            await ctx.telegram.editMessageText(ctx.chat.id, messageIdToEdit, null, "⚠️ File > 50MB (Telegram Limit).");
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
            return;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, messageIdToEdit, null, "📤 *Uploading...*", { parse_mode: 'Markdown' });
        
        if (isAudio) {
            await ctx.replyWithAudio({ source: finalFile }, { 
                caption: captionText || '🎵 Audio extracted by Media Banai',
                parse_mode: 'HTML' 
            });
        } else {
            await ctx.replyWithVideo({ source: finalFile }, { 
                caption: captionText || '🚀 Downloaded via Media Banai',
                parse_mode: 'HTML' 
            });
        }

        console.log(`✅ Upload Success: ${url}`);
        await ctx.telegram.deleteMessage(ctx.chat.id, messageIdToEdit).catch(() => {});
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);

    } catch (e) {
        console.error(`Download Error: ${e.message}`);
        await ctx.telegram.editMessageText(ctx.chat.id, messageIdToEdit, null, "❌ Error during download.");
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);
        if (fs.existsSync(`${basePath}.mp4`)) fs.unlinkSync(`${basePath}.mp4`);
    }
};

// --- MESSAGE HANDLER ---
const handleMessage = async (ctx) => {
    const match = ctx.message.text.match(config.URL_REGEX);
    if (!match) return;

    console.log(`📩 New Request: ${match[0]}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(match[0]);
        let media = null;
        let platformName = 'Social';

        if (fullUrl.includes('x.com') || fullUrl.includes('twitter.com')) {
            media = await twitterService.extract(fullUrl);
            platformName = 'Twitter';
        } else {
            media = await redditService.extract(fullUrl);
            platformName = 'Reddit';
        }

        if (!media) throw new Error("Media not found");

        const safeUrl = media.url || media.source;
        // Generate the new pretty caption
        const prettyCaption = generateCaption(media.title, platformName, media.source);

        // --- AUTO-DOWNLOAD (Quality Check Failed) ---
        if (media.type === 'video' && (!media.formats || media.formats.length === 0)) {
            console.log("⚠️ No resolutions found. Auto-Downloading.");
            return await performDownload(ctx, safeUrl, false, 'best', msg.message_id, prettyCaption);
        }

        // --- BUTTONS MENU ---
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
            const formats = media.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height);
            const seen = new Set();
            formats.slice(0, 5).forEach(f => {
                if(!seen.has(f.height)) {
                    seen.add(f.height);
                    buttons.push([Markup.button.callback(`📹 ${f.height}p`, `vid|${f.format_id}`)]);
                }
            });
            buttons.push([Markup.button.callback("🎵 Audio Only", "aud|best")]);
        }

        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            `${text}\n👤 Author: ${media.author}\nSource: [Link](${safeUrl})`,
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
    
    const messageText = ctx.callbackQuery.message.text || "Media Content";
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    
    if (!url) return ctx.answerCbQuery("❌ Link expired.");

    // Guess platform from URL
    let platformName = 'Social';
    if (url.includes('twitter') || url.includes('x.com')) platformName = 'Twitter';
    else if (url.includes('reddit')) platformName = 'Reddit';

    const rawTitle = messageText.split('\n')[0].replace('✅ ', '');
    // Generate caption for button clicks
    const niceCaption = generateCaption(rawTitle, platformName, url);

    if (action === 'img') {
        await ctx.answerCbQuery("🚀 Sending...");
        try { await ctx.replyWithPhoto(url, { caption: niceCaption, parse_mode: 'HTML' }); } 
        catch { await ctx.replyWithDocument(url, { caption: niceCaption, parse_mode: 'HTML' }); }
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
        await performDownload(ctx, url, action === 'aud', id, ctx.callbackQuery.message.message_id, niceCaption);
    }
};

module.exports = { handleMessage, handleCallback };