const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const { translate } = require('google-translate-api-x');
const db = require('./db');
const { resolveRedirect } = require('./helpers'); 
const downloader = require('./downloader');
const redditService = require('../services/reddit');

// --- HELPERS ---
const getFlagEmoji = (code) => {
    if (!code || code.length !== 2) return '🇧🇩';
    return code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
};

const generateCaption = (text, platform, sourceUrl, flagEmoji) => {
    const cleanText = text ? (text.length > 900 ? text.substring(0, 897) + '...' : text) : "Media Content";
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `🎬 <b>${platform} media</b> | <a href="${sourceUrl}">source</a> ${flagEmoji || '🇧🇩'}\n\n<blockquote>${safeText}</blockquote>`;
};

const getTranslationButtons = () => Markup.inlineKeyboard([[
    Markup.button.callback('🇺🇸 English', 'trans|en'), 
    Markup.button.callback('🇧🇩 Bangla', 'trans|bn')
]]);

// --- CORE LOGIC ---
const performDownload = async (ctx, url, isAudio, qualityId, botMsgId, captionText) => {
    let finalFile = "";
    try {
        await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, "⏳ <b>Processing...</b>", { parse_mode: 'HTML' }).catch(()=>{});
        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;

        await downloader.download(url, isAudio, qualityId, basePath);
        
        if (fs.existsSync(finalFile)) {
            const stats = fs.statSync(finalFile);
            if (!isAudio && stats.size > 49.5 * 1024 * 1024) {
                const parts = await downloader.splitFile(finalFile);
                for (let i = 0; i < parts.length; i++) {
                    await ctx.replyWithVideo({ source: parts[i] }, { caption: `${captionText} (Part ${i+1})`, parse_mode: 'HTML' });
                    if (fs.existsSync(parts[i])) fs.unlinkSync(parts[i]);
                }
            } else {
                const extra = { caption: captionText, parse_mode: 'HTML', ...getTranslationButtons() };
                isAudio ? await ctx.replyWithAudio({ source: finalFile }, extra) : await ctx.replyWithVideo({ source: finalFile }, extra);
            }
            await ctx.telegram.deleteMessage(ctx.chat.id, botMsgId).catch(()=>{});
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
        }
    } catch (e) {
        await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, `❌ <b>Failed:</b> ${e.message.substring(0, 50)}`, { parse_mode: 'HTML' }).catch(()=>{});
    }
};

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
            media = await downloader.getInfo(fullUrl);
        } else if (fullUrl.includes('reddit.com')) {
            platform = "Reddit";
            media = await redditService.extract(fullUrl);
        } else {
            const info = await downloader.getInfo(fullUrl);
            media = { title: info.title, source: fullUrl, type: 'video', url: fullUrl };
        }

        const caption = generateCaption(postText || media.title, platform, fullUrl, '🇧🇩');
        const buttons = media.type === 'video' ? [[Markup.button.callback("📹 Video", `vid|best`), Markup.button.callback("🎵 Audio", `aud|best`)]] : [[Markup.button.callback("🖼 Download Image", `img|single`)]];
        const markup = Markup.inlineKeyboard([...buttons, ...getTranslationButtons().reply_markup.inline_keyboard]);

        if (media.type === 'image' || media.is_image) {
            const imgPath = path.join(config.DOWNLOAD_DIR, `img_${Date.now()}.jpg`);
            await downloader.downloadGeneric(media.url, imgPath);
            await ctx.replyWithPhoto({ source: imgPath }, { caption, parse_mode: 'HTML', ...markup });
            await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, caption, { parse_mode: 'HTML', ...markup });
        }
    } catch (e) { 
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ <b>Error:</b> Media not found.`).catch(()=>{}); 
    }
};

// --- SYSTEM HANDLERS ---
const handleStart = async (ctx) => {
    db.addUser(ctx);
    const text = `👋 <b>Welcome!</b>\nTwitter, Reddit, Instagram & TikTok support ✅`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('📚 Help', 'help_msg'), Markup.button.callback('📊 Stats', 'stats_msg')]]);
    ctx.callbackQuery ? await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{}) : await ctx.reply(text, { parse_mode: 'HTML', ...buttons });
};

const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    if (action === 'start_msg') return handleStart(ctx);
    
    const entities = ctx.callbackQuery.message.caption_entities || ctx.callbackQuery.message.entities;
    const url = entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Link not found");

    if (action === 'vid' || action === 'aud') {
        await ctx.answerCbQuery("🚀 Processing...");
        await performDownload(ctx, url, action === 'aud', id, ctx.callbackQuery.message.message_id, ctx.callbackQuery.message.caption);
    } else if (action === 'img') {
        await ctx.answerCbQuery("Sending Image...");
        const imgPath = path.join(config.DOWNLOAD_DIR, `img_${Date.now()}.jpg`);
        await downloader.downloadGeneric(url, imgPath);
        await ctx.replyWithPhoto({ source: imgPath }).catch(() => ctx.replyWithDocument({ source: imgPath }));
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
};

module.exports = { 
    handleMessage, handleCallback, handleStart, performDownload,
    handleHelp: (ctx) => ctx.reply("📚 Use /start to see features."),
    handleConfig: (ctx) => ctx.reply("⚙️ Admin config active."),
    handleEditCaption: () => false
};
