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

// --- ১. হেল্পার ফাংশনসমূহ ---
const getFlagEmoji = (code) => {
    if (!code || code.length !== 2) return '🇧🇩';
    return code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
};

const generateCaption = (text, platform, sourceUrl, flagEmoji) => {
    const cleanText = text ? (text.length > 900 ? text.substring(0, 897) + '...' : text) : "Media Content";
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `🎬 <b>${platform} media</b> | <a href="${sourceUrl}">source</a> ${flagEmoji || '🇧🇩'}\n\n<blockquote>${safeText}</blockquote>`;
};

const getTranslationButtons = () => Markup.inlineKeyboard([[Markup.button.callback('🇺🇸 English', 'trans|en'), Markup.button.callback('🇧🇩 Bangla', 'trans|bn')]]);

// --- ২. স্টার্ট ও হেল্প হ্যান্ডলার ---
const handleStart = async (ctx) => {
    db.addUser(ctx);
    const text = `👋 <b>Welcome!</b>\nI download from Twitter, Reddit, Instagram & TikTok.\n• Auto-Split 50MB+\n• Video/Image/GIF Support`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('📚 Help', 'help_msg'), Markup.button.callback('📊 Stats', 'stats_msg')]]);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    else await ctx.reply(text, { parse_mode: 'HTML', ...buttons });
};

const handleHelp = async (ctx) => {
    const text = `📚 <b>Help</b>\n1. Send link\n2. /caption New Text (Reply to bot)\n3. /setnick Name (Group only)`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'start_msg')]]);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    else await ctx.reply(text, { parse_mode: 'HTML' });
};

// --- ৩. এডমিন কনফিগ হ্যান্ডলার ---
const handleConfig = async (ctx) => {
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;
    const text = ctx.message.text;
    if (text.startsWith('/set_destination')) {
        let targetId = text.includes('reset') ? "" : ctx.chat.id;
        await db.setWebhookTarget(config.ADMIN_ID, targetId);
        return ctx.reply(`✅ Webhook target updated.`);
    }
    if (text.startsWith('/mode')) {
        const mode = text.split(' ')[1];
        await db.toggleMode(ctx.from.id, mode);
        return ctx.reply(`🔄 Mode: ${mode}`);
    }
};

// --- ৪. ক্যাপশন এডিটর হ্যান্ডলার ---
const handleEditCaption = async (ctx) => {
    const text = ctx.message.text;
    if (!text?.startsWith('/caption') || !ctx.message.reply_to_message) return false;
    const newCaption = text.replace(/^\/caption\s*/, '').trim();
    if (!newCaption) return true;
    try {
        await ctx.telegram.editMessageCaption(ctx.chat.id, ctx.message.reply_to_message.message_id, null, newCaption, { parse_mode: 'HTML', reply_markup: ctx.message.reply_to_message.reply_markup });
        await ctx.deleteMessage().catch(()=>{});
    } catch (e) { console.error(e); }
    return true;
};

// --- ৫. ডাউনলোড এক্সিকিউশন লজিক ---
const performDownload = async (ctx, url, isAudio, qualityId, botMsgId, captionText) => {
    let finalFile = "";
    try {
        await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, "⏳ <b>Downloading...</b>", { parse_mode: 'HTML' }).catch(()=>{});
        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;

        await downloader.download(url, isAudio, qualityId, basePath);
        
        let filesToSend = [finalFile];
        if (fs.existsSync(finalFile)) {
            const stats = fs.statSync(finalFile);
            if (!isAudio && stats.size > 49.5 * 1024 * 1024) {
                await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, "⚠️ <b>File > 50MB. Splitting...</b>", { parse_mode: 'HTML' }).catch(()=>{});
                filesToSend = await downloader.splitFile(finalFile);
            }
        }

        for (let i = 0; i < filesToSend.length; i++) {
            const file = filesToSend[i];
            const cap = i === 0 ? captionText : `${captionText}\n\n🧩 <b>Part ${i + 1}</b>`;
            if (isAudio) await ctx.replyWithAudio({ source: file }, { caption: cap, parse_mode: 'HTML' });
            else await ctx.replyWithVideo({ source: file }, { caption: cap, parse_mode: 'HTML' });
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        await ctx.telegram.deleteMessage(ctx.chat.id, botMsgId).catch(()=>{});
        db.incrementDownloads(ctx.from?.id);
    } catch (e) {
        await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, `❌ Failed: ${e.message.substring(0, 50)}`, { parse_mode: 'HTML' }).catch(()=>{});
        if (finalFile && fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
};

// --- ৬. প্রধান মেসেজ হ্যান্ডলার (Fixes ReferenceError) ---
const handleMessage = async (ctx) => {
    db.addUser(ctx);
    const text = ctx.message.text;
    const match = text?.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    const postText = text.split(inputUrl)[1]?.trim();
    const msg = await ctx.reply("🔍 *Analyzing media...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(inputUrl);
        let media = null;
        let platform = "Social";

        if (fullUrl.includes('twitter.com') || fullUrl.includes('x.com')) {
            platform = "Twitter";
            try {
                const info = await downloader.getInfo(fullUrl);
                media = { 
                    title: info.title, source: fullUrl, 
                    type: info.is_image ? 'image' : 'video', 
                    url: info.url, thumbnail: info.thumbnail, 
                    formats: info.formats || [] 
                };
            } catch (e) { 
                const vxUrl = fullUrl.replace('x.com', 'vxtwitter.com').replace('twitter.com', 'vxtwitter.com');
                media = { title: "Twitter Image", source: fullUrl, type: 'image', url: vxUrl };
            }
        } else if (fullUrl.includes('reddit.com')) {
            media = await redditService.extract(fullUrl);
            platform = "Reddit";
        } else {
            const info = await downloader.getInfo(fullUrl);
            media = { title: info.title, source: fullUrl, type: 'video', url: fullUrl, formats: info.formats };
        }

        const caption = generateCaption(postText || media.title, platform, fullUrl, '🇧🇩');
        const buttons = media.type === 'video' ? [[Markup.button.callback("📹 Download Video", `vid|best`), Markup.button.callback("🎵 Audio", `aud|best`)]] : [[Markup.button.callback("🖼 Download Image", `img|single`)]];
        const markup = Markup.inlineKeyboard([...buttons, ...getTranslationButtons().reply_markup.inline_keyboard]);

        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
        
        if (media.type === 'image') {
            const imgPath = path.join(config.DOWNLOAD_DIR, `img_${Date.now()}.jpg`);
            await downloader.downloadGeneric(media.url, imgPath);
            await ctx.replyWithPhoto({ source: imgPath }, { caption, parse_mode: 'HTML', ...markup });
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        } else {
            await ctx.reply(caption, { parse_mode: 'HTML', ...markup });
        }
    } catch (e) { 
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Media not found.").catch(()=>{}); 
    }
};

// --- ৭. গ্রুপ মেসেজ ও নিকনেম হ্যান্ডলার ---
const handleGroupMessage = async (ctx, next) => {
    if (!ctx.message?.text) return next();
    const text = ctx.message.text;
    if (text.startsWith('/setnick')) {
        const parts = text.split(' ');
        if (parts.length < 2 || !ctx.message.reply_to_message) return ctx.reply("Usage: Reply + /setnick name");
        await db.setNickname(ctx.chat.id, parts[1].toLowerCase(), ctx.message.reply_to_message.from.id);
        return ctx.reply("✅ Nickname set!");
    }
    const nick = await db.getNickname(ctx.chat.id, text.trim().toLowerCase());
    if (nick) return ctx.reply(`👋 Mentioned <a href="tg://user?id=${nick.targetId}">User</a>`, { parse_mode: 'HTML' });
    return next();
};

// --- ৮. কলব্যাক হ্যান্ডলার ---
const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    if (action === 'help_msg') return handleHelp(ctx);
    if (action === 'start_msg') return handleStart(ctx);
    
    const entities = ctx.callbackQuery.message.caption_entities || ctx.callbackQuery.message.entities;
    const url = entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Link not found");

    if (action === 'vid' || action === 'aud') {
        await ctx.answerCbQuery("🚀 Processing...");
        await performDownload(ctx, url, action === 'aud', id, ctx.callbackQuery.message.message_id, ctx.callbackQuery.message.caption);
    } else if (action === 'img') {
        await ctx.answerCbQuery("Sending...");
        const imgPath = path.join(config.DOWNLOAD_DIR, `img_${Date.now()}.jpg`);
        await downloader.downloadGeneric(url, imgPath);
        await ctx.replyWithPhoto({ source: imgPath }).catch(() => ctx.replyWithDocument({ source: imgPath }));
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        await ctx.deleteMessage().catch(()=>{});
    }
};

// --- ৯. এক্সপোর্ট ব্লক (একদম শেষে) ---
module.exports = { 
    handleMessage, 
    handleCallback, 
    handleGroupMessage, 
    handleStart, 
    handleHelp, 
    handleConfig, 
    handleEditCaption,
    performDownload 
};
