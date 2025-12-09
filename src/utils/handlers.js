const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const { translate } = require('google-translate-api-x');
const db = require('./db');

const { resolveRedirect } = require('./helpers'); 
const downloader = require('./downloader');
const redditService = require('../services/reddit');
const twitterService = require('../services/twitter');

// --- HELPERS ---
const getFlagEmoji = (code) => {
    if (!code || code.length !== 2) return '🇧🇩';
    return code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
};

const generateCaption = (text, platform, sourceUrl, flagEmoji) => {
    const cleanText = text ? (text.length > 900 ? text.substring(0, 897) + '...' : text) : "Media Content";
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const validFlag = flagEmoji || '🇧🇩';
    return `🎬 <b>${platform} media</b> | <a href="${sourceUrl}">source</a> ${validFlag}\n\n<blockquote>${safeText}</blockquote>`;
};

const getTranslationButtons = () => {
    return Markup.inlineKeyboard([[
        Markup.button.callback('🇺🇸 English', 'trans|en'),
        Markup.button.callback('🇧🇩 Bangla', 'trans|bn')
    ]]);
};

// --- START & HELP ---
const handleStart = async (ctx) => {
    db.addUser(ctx);
    const text = `👋 <b>Welcome to Media Banai!</b>\nI can download from Twitter/X and Reddit.\n\n<b>Features:</b>\n• Auto-Download\n• Ghost Mentions (Groups)\n• Translation`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('📚 Help', 'help_msg'), Markup.button.callback('📊 Stats', 'stats_msg')]]);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    else await ctx.reply(text, { parse_mode: 'HTML', ...buttons });
};

const handleHelp = async (ctx) => {
    const text = `📚 <b>Help Guide</b>\n\n<b>1. Downloads:</b> Send any X/Reddit link.\n<b>2. Custom Caption:</b> Add text after link.\n<b>3. Ghost Mention:</b> Reply to user & type <code>/setnick name</code>. Then type name to tag.`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'start_msg')]]);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    else await ctx.reply(text, { parse_mode: 'HTML' });
};

// --- DOWNLOADER ---
const performDownload = async (ctx, url, isAudio, qualityId, botMsgId, captionText, userMsgId) => {
    try {
        if (userMsgId) { try { await ctx.telegram.deleteMessage(ctx.chat.id, userMsgId); } catch (err) {} }

        await ctx.telegram.editMessageText(ctx.chat.id, botMsgId, null, `⏳ *Downloading...*`, { parse_mode: 'Markdown' });

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
        
        const extraOptions = { caption: captionText || '🚀 Media Banai', parse_mode: 'HTML', ...getTranslationButtons() };

        if (isAudio) await ctx.replyWithAudio({ source: finalFile }, extraOptions);
        else await ctx.replyWithVideo({ source: finalFile }, extraOptions);

        // ✅ NEW: Increment stats for this specific user
        const userId = ctx.callbackQuery ? ctx.callbackQuery.from.id : (ctx.message ? ctx.message.from.id : null);
        db.incrementDownloads(userId);

        console.log(`✅ Upload Success`);
        await ctx.telegram.deleteMessage(ctx.chat.id, botMsgId).catch(() => {});
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);

    } catch (e) {
        console.error(`Download Error: ${e.message}`);
        await ctx.telegram.editMessageText(ctx.chat.id, botMsgId, null, "❌ Error.");
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`);
        if (fs.existsSync(`${basePath}.mp4`)) fs.unlinkSync(`${basePath}.mp4`);
    }
};

// --- MAIN MESSAGE HANDLER ---
const handleMessage = async (ctx) => {
    db.addUser(ctx); // Track User

    const messageText = ctx.message.text;
    if (!messageText) return; 

    const match = messageText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    const parts = messageText.split(inputUrl);
    const preText = parts[0].trim(); 
    const postText = parts[1].trim(); 

    let flagEmoji = '🇧🇩';
    if (preText.length === 2 && /^[a-zA-Z]+$/.test(preText)) flagEmoji = getFlagEmoji(preText);

    const userCustomCaption = postText; 
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
        const prettyCaption = generateCaption(finalTitleText, platformName, media.source, flagEmoji);

        if (media.type === 'video' && (!media.formats || media.formats.length === 0)) {
            return await performDownload(ctx, safeUrl, false, 'best', msg.message_id, prettyCaption, ctx.message.message_id);
        }

        const buttons = [];
        let previewText = `✅ ${flagEmoji} *${finalTitleText.substring(0, 50)}...*`;

        if (media.type === 'gallery') buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        else if (media.type === 'image') buttons.push([Markup.button.callback(`🖼 Download Image`, `img|single`)]);
        else if (media.type === 'video') {
            const formats = media.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height);
            const seen = new Set();
            formats.slice(0, 5).forEach(f => {
                if(!seen.has(f.height)) { seen.add(f.height); buttons.push([Markup.button.callback(`📹 ${f.height}p`, `vid|${f.format_id}`)]); }
            });
            buttons.push([Markup.button.callback("🎵 Audio Only", "aud|best")]);
        }

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `${previewText}\n👤 Author: ${media.author}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });

    } catch (e) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
};

// --- GHOST MENTION HANDLER ---
const handleGroupMessage = async (ctx, next) => {
    const messageText = ctx.message.text;

    // 1. SET NICKNAME
    if (messageText && messageText.startsWith('/setnick')) {
        const parts = messageText.split(' ');
        if (parts.length < 2) return ctx.reply("⚠️ Usage: Reply + /setnick <name>");
        const nickName = parts[1].toLowerCase();
        if (!ctx.message.reply_to_message) return ctx.reply("⚠️ Reply to a user first.");
        
        await db.setNickname(ctx.chat.id, nickName, ctx.message.reply_to_message.from.id);
        return ctx.reply(`✅ Nickname set! Type <b>${nickName}</b> to mention user.`, { parse_mode: 'HTML' });
    }

    // 2. DELETE NICKNAME
    if (messageText && messageText.startsWith('/delnick')) {
        const parts = messageText.split(' ');
        if (parts.length < 2) return;
        await db.deleteNickname(ctx.chat.id, parts[1]);
        return ctx.reply(`🗑 Nickname '${parts[1]}' deleted.`);
    }

    // 3. TRIGGER MENTION
    if (messageText) {
        const cleanText = messageText.trim().toLowerCase();
        const nickEntry = await db.getNickname(ctx.chat.id, cleanText);
        
        if (nickEntry) {
            // Found a nickname!
            try { 
                await ctx.deleteMessage(); // Try to delete user message
            } catch (e) {
                // If bot is not admin, it fails. We ignore error and send mention anyway.
                console.log("⚠️ Could not delete message (Bot not admin?)");
            }
            
            await ctx.reply(`👋 <b>${ctx.from.first_name}</b> mentioned <a href="tg://user?id=${nickEntry.targetId}">User</a>`, { parse_mode: 'HTML' });
            return; // Stop here, do not process as a link
        }
    }
    return next();
};

// --- CALLBACK HANDLER ---
const handleCallback = async (ctx) => {
    db.addUser(ctx);
    const data = ctx.callbackQuery.data;
    const [action, id] = data.split('|');
    
    if (action === 'help_msg') return handleHelp(ctx);
    if (action === 'start_msg') return handleStart(ctx);
    if (action === 'stats_msg') return ctx.answerCbQuery("Use /stats command.", { show_alert: true });

    if (action === 'trans') {
        const targetLang = id; 
        const messageCaption = ctx.callbackQuery.message.caption;
        if (!messageCaption) return ctx.answerCbQuery("No text.");
        await ctx.answerCbQuery("Translating...");

        let currentFlag = '🇧🇩'; 
        const sourceLine = messageCaption.split('\n')[0]; 
        const flagMatch = sourceLine.match(/source\s+(.+)$/); 
        if (flagMatch && flagMatch[1]) currentFlag = flagMatch[1].trim(); 

        const entities = ctx.callbackQuery.message.caption_entities;
        const linkEntity = entities?.find(e => e.type === 'text_link');
        const sourceUrl = linkEntity ? linkEntity.url : "https://google.com";
        
        const lines = messageCaption.split('\n');
        let contentToTranslate = lines.length > 2 ? lines.slice(2).join('\n').trim() : messageCaption;

        try {
            const res = await translate(contentToTranslate, { to: targetLang, autoCorrect: true });
            const newCaption = generateCaption(res.text, 'Social', sourceUrl, currentFlag);
            await ctx.editMessageCaption(newCaption, { parse_mode: 'HTML', ...getTranslationButtons() });
        } catch (e) { await ctx.answerCbQuery("❌ Translation failed."); }
        return;
    }

    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Link expired.");

    if (action === 'img') {
        await ctx.answerCbQuery("Sending...");
        await ctx.replyWithPhoto(url, { caption: "Image", parse_mode: 'HTML' });
        await ctx.deleteMessage();
    }
    else if (action === 'alb') {
        await ctx.answerCbQuery("Processing...");
        await ctx.deleteMessage();
    }
    else {
        await ctx.answerCbQuery("Downloading...");
        await performDownload(ctx, url, action === 'aud', id, ctx.callbackQuery.message.message_id, null, null);
    }
};

module.exports = { handleMessage, handleCallback, handleGroupMessage, handleStart, handleHelp };