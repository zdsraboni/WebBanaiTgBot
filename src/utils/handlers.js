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
    const cleanText = text.length > 900 ? text.substring(0, 897) + '...' : text;
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `🎬 <b>${platform} media</b> | <a href="${sourceUrl}">source</a>\n\n<blockquote>${safeText}</blockquote>`;
};

// --- SHARED DOWNLOAD FUNCTION ---
// Added 'userMsgId' to the arguments
const performDownload = async (ctx, url, isAudio, qualityId, botMsgId, captionText, userMsgId) => {
    try {
        // 1. Try to Delete User's Message (The Link)
        // Wrapped in try/catch because bots can't delete user messages in Private chats
        if (userMsgId) {
            try {
                await ctx.telegram.deleteMessage(ctx.chat.id, userMsgId);
            } catch (err) {
                // Silently fail if in Private chat or missing permissions
            }
        }

        // 2. Update Bot Message to "Downloading"
        await ctx.telegram.editMessageText(
            ctx.chat.id, botMsgId, null, 
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
            await ctx.telegram.editMessageText(ctx.chat.id, botMsgId, null, "⚠️ File > 50MB (Telegram Limit).");
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
            return;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, botMsgId, null, "📤 *Uploading...*", { parse_mode: 'Markdown' });
        
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
        
        // Delete the "Uploading..." status message
        await ctx.telegram.deleteMessage(ctx.chat.id, botMsgId).catch(() => {});
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);

    } catch (e) {
        console.error(`Download Error: ${e.message}`);
        await ctx.telegram.editMessageText(ctx.chat.id, botMsgId, null, "❌ Error during download.");
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);
        if (fs.existsSync(`${basePath}.mp4`)) fs.unlinkSync(`${basePath}.mp4`);
    }
};

// --- MESSAGE HANDLER ---
const handleMessage = async (ctx) => {
    const messageText = ctx.message.text;
    const match = messageText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    const userCustomCaption = messageText.replace(inputUrl, '').trim();

    console.log(`📩 New Request: ${inputUrl}`);
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
        const finalTitleText = userCustomCaption.length > 0 ? userCustomCaption : media.title;
        const prettyCaption = generateCaption(finalTitleText, platformName, media.source);

        // --- AUTO-DOWNLOAD (Quality Check Failed) ---
        if (media.type === 'video' && (!media.formats || media.formats.length === 0)) {
            console.log("⚠️ No resolutions found. Auto-Downloading.");
            // Pass ctx.message.message_id to delete it
            return await performDownload(ctx, safeUrl, false, 'best', msg.message_id, prettyCaption, ctx.message.message_id);
        }

        // --- BUTTONS MENU ---
        const buttons = [];
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

    let titleToUse = "Media Content";
    const msgText = ctx.callbackQuery.message.text;
    if (msgText) {
        const firstLine = msgText.split('\n')[0];
        titleToUse = firstLine.replace('✅ ', '');
    }

    const niceCaption = generateCaption(titleToUse, platformName, url);

    // Identify the Original User Message ID (The one the bot replied to)
    const userOriginalMsgId = ctx.callbackQuery.message.reply_to_message?.message_id;

    if (action === 'img') {
        await ctx.answerCbQuery("🚀 Sending...");
        try { 
            await ctx.replyWithPhoto(url, { caption: niceCaption, parse_mode: 'HTML' });
            // Try delete user msg for Image too
            if(userOriginalMsgId) await ctx.telegram.deleteMessage(ctx.chat.id, userOriginalMsgId).catch(()=>{});
        } 
        catch { await ctx.replyWithDocument(url, { caption: niceCaption, parse_mode: 'HTML' }); }
        
        await ctx.deleteMessage(); // Delete menu
    }
    else if (action === 'alb') {
        await ctx.answerCbQuery("🚀 Processing...");
        // Album logic... (kept simple for now)
        let media = null;
        if (url.includes('x.com') || url.includes('twitter')) media = await twitterService.extract(url);
        else media = await redditService.extract(url);

        if (media?.type === 'gallery') {
            // Delete menu
            await ctx.deleteMessage();
            // Try delete user msg
            if(userOriginalMsgId) await ctx.telegram.deleteMessage(ctx.chat.id, userOriginalMsgId).catch(()=>{});

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
        // Pass userOriginalMsgId to the downloader to delete it
        await performDownload(ctx, url, action === 'aud', id, ctx.callbackQuery.message.message_id, niceCaption, userOriginalMsgId);
    }
};

module.exports = { handleMessage, handleCallback };