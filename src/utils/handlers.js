const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');

const { resolveRedirect } = require('./helpers'); 
const downloader = require('./downloader');
const redditService = require('../services/reddit');
const twitterService = require('../services/twitter');

// --- HELPER: GENERATE UI CAPTION ---
const generateCaption = (text, platform, sourceUrl) => {
    // 1. Telegram Limit Strategy
    // Telegram caption limit is 1024 chars. We reserve ~100 chars for our UI tags.
    // So we allow up to 900 characters of the actual text before cutting.
    const cleanText = text.length > 900 ? text.substring(0, 897) + '...' : text;
    
    // 2. Escape HTML (Security)
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 3. The "Screenshot Style" UI
    return `🎬 <b>${platform} media</b> | <a href="${sourceUrl}">source</a>\n\n<blockquote>${safeText}</blockquote>`;
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
        // Cleanup
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);
        if (fs.existsSync(`${basePath}.mp4`)) fs.unlinkSync(`${basePath}.mp4`);
    }
};

// --- MESSAGE HANDLER ---
const handleMessage = async (ctx) => {
    const messageText = ctx.message.text;
    const match = messageText.match(config.URL_REGEX);
    if (!match) return;

    // 1. Check for Custom User Caption
    // We remove the URL from the message. If anything is left, that's the custom caption.
    const inputUrl = match[0];
    const userCustomCaption = messageText.replace(inputUrl, '').trim();

    console.log(`📩 New Request: ${inputUrl} | Custom Caption: ${userCustomCaption ? 'YES' : 'NO'}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(inputUrl);
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

        // 2. Decide which text to use (Custom OR Original)
        const finalTitleText = userCustomCaption.length > 0 ? userCustomCaption : media.title;
        
        // 3. Generate the UI
        const prettyCaption = generateCaption(finalTitleText, platformName, media.source);

        // --- AUTO-DOWNLOAD (Quality Check Failed) ---
        if (media.type === 'video' && (!media.formats || media.formats.length === 0)) {
            console.log("⚠️ No resolutions found. Auto-Downloading.");
            return await performDownload(ctx, safeUrl, false, 'best', msg.message_id, prettyCaption);
        }

        // --- BUTTONS MENU ---
        const buttons = [];
        
        // Use the same final text for the "Found:" preview
        let previewText = `✅ *${finalTitleText.substring(0, 50)}...*`;

        if (media.type === 'gallery') {
            previewText += `\n📚 **Gallery:** ${media.items.length} items`;
            buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        } 
        else if (media.type === 'image') {
            previewText += `\n🖼 **Image Detected**`;
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

        // We store the "Custom Caption" implicitly by not passing it in callback data
        // (Callback data is too small). 
        // Instead, the Callback Handler below will re-extract it from the message text if possible,
        // or we rely on the fact that the user sees the preview.
        
        // Ideally, we just show the preview here.
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            `${previewText}\n👤 Author: ${media.author}\nSource: [Link](${safeUrl})`,
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

    let platformName = 'Social';
    if (url.includes('twitter') || url.includes('x.com')) platformName = 'Twitter';
    else if (url.includes('reddit')) platformName = 'Reddit';

    // RE-EXTRACT TITLE FROM MENU MESSAGE
    // The menu message format is: "✅ *Title...*"
    // We try to grab that title back to use in the caption
    let titleToUse = "Media Content";
    const msgText = ctx.callbackQuery.message.text;
    if (msgText) {
        // Split by new line, take first line, remove "✅ "
        const firstLine = msgText.split('\n')[0];
        titleToUse = firstLine.replace('✅ ', '');
    }

    const niceCaption = generateCaption(titleToUse, platformName, url);

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