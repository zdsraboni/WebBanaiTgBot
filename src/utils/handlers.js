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
    return Markup.inlineKeyboard([[Markup.button.callback('🇺🇸 English', 'trans|en'), Markup.button.callback('🇧🇩 Bangla', 'trans|bn')]]);
};

// --- START & HELP ---
const handleStart = async (ctx) => {
    db.addUser(ctx);
    const text = `👋 <b>Welcome to Media Banai!</b>\nI can download from Twitter, Reddit, Instagram & TikTok.`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('📚 Help', 'help_msg'), Markup.button.callback('📊 Stats', 'stats_msg')]]);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    else await ctx.reply(text, { parse_mode: 'HTML', ...buttons });
};

const handleHelp = async (ctx) => {
    const text = `📚 <b>Help Guide</b>\n\n<b>1. Downloads:</b> Send any valid link.\n<b>2. Custom Caption:</b> Add text after link.\n<b>3. Edit Caption:</b> Reply with <code>/caption New Text</code>.`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'start_msg')]]);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    else await ctx.reply(text, { parse_mode: 'HTML' });
};

// --- CONFIG HANDLER ---
const handleConfig = async (ctx) => {
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;
    const text = ctx.message.text;

    if (text.startsWith('/set_destination')) {
        let targetId = ctx.chat.id;
        let title = ctx.chat.title || "Private Chat";
        if (text.includes('reset')) { targetId = ""; title = "Default"; }
        await db.setWebhookTarget(config.ADMIN_ID, targetId);
        return ctx.reply(`✅ Target: <b>${title}</b>`, { parse_mode: 'HTML' });
    }
    if (text.startsWith('/setup_api')) {
        const parts = text.split(' ');
        if (parts.length < 3) return ctx.reply("Usage: /setup_api KEY USER");
        await db.updateApiConfig(ctx.from.id, parts[1], parts[2]);
        return ctx.reply("✅ Twitter API Configured!");
    }
    if (text.startsWith('/mode')) {
        const mode = text.split(' ')[1];
        await db.toggleMode(ctx.from.id, mode);
        return ctx.reply(`🔄 Mode: <b>${mode}</b>`, { parse_mode: 'HTML' });
    }
};

// --- CAPTION EDITOR ---
const handleEditCaption = async (ctx) => {
    const text = ctx.message.text;
    if (!text || !text.startsWith('/caption')) return false;
    if (!ctx.message.reply_to_message || ctx.message.reply_to_message.from.id !== ctx.botInfo.id) return true;

    const newCaption = text.replace(/^\/caption\s*/, '').trim();
    if (!newCaption) return true;

    try {
        await ctx.telegram.editMessageCaption(
            ctx.chat.id,
            ctx.message.reply_to_message.message_id,
            null,
            newCaption,
            { parse_mode: 'HTML', reply_markup: ctx.message.reply_to_message.reply_markup }
        );
        await ctx.deleteMessage().catch(()=>{});
    } catch (e) {}
    return true;
};

// --- DOWNLOADER (FIXED VERSION) ---
const performDownload = async (ctx, url, type, qualityId, botMsgId, htmlCaption, userMsgId) => {
    let basePath = ''; // ফিক্স: catch ব্লকের জন্য স্কোপ ঠিক করা হয়েছে
    try {
        if (userMsgId && userMsgId !== 0) { try { await ctx.telegram.deleteMessage(ctx.chat.id, userMsgId); } catch (err) {} }
        try { await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, "⏳ <b>Downloading...</b>", { parse_mode: 'HTML' }); } catch (e) {}

        const timestamp = Date.now();
        basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        
        let ext = type === 'audio' ? 'mp3' : (type === 'image' ? 'jpg' : 'mp4');
        const finalFile = `${basePath}.${ext}`;

        // টাইপ অনুযায়ী আপনার দেওয়া downloader.js এর ফাংশন কল করা
        if (type === 'image') {
            await downloader.downloadFile(url, finalFile); 
        } else {
            const isAudio = type === 'audio';
            await downloader.download(url, isAudio, qualityId, basePath);
        }

        let filesToSend = [finalFile];
        const stats = fs.statSync(finalFile);
        
        if (type === 'video' && stats.size > 49.5 * 1024 * 1024) {
            await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, "⚠️ <b>File > 50MB. Splitting...</b>", { parse_mode: 'HTML' });
            filesToSend = await downloader.splitFile(finalFile);
        }

        for (let i = 0; i < filesToSend.length; i++) {
            const file = filesToSend[i];
            if (i === 0) {
                try {
                    let tgType = type === 'audio' ? 'audio' : (type === 'image' ? 'photo' : 'video');
                    await ctx.telegram.editMessageMedia(
                        ctx.chat.id, botMsgId, null,
                        { type: tgType, media: { source: file }, caption: htmlCaption, parse_mode: 'HTML' },
                        { ...getTranslationButtons().reply_markup }
                    );
                } catch (editError) {
                    // ফিক্স: IMAGE_PROCESS_FAILED এরর হলে নতুন মেসেজে পাঠানো
                    await ctx.telegram.deleteMessage(ctx.chat.id, botMsgId).catch(()=>{});
                    if (type === 'audio') await ctx.replyWithAudio({ source: file }, { caption: htmlCaption, parse_mode: 'HTML', ...getTranslationButtons() });
                    else if (type === 'image') await ctx.replyWithPhoto({ source: file }, { caption: htmlCaption, parse_mode: 'HTML', ...getTranslationButtons() });
                    else await ctx.replyWithVideo({ source: file }, { caption: htmlCaption, parse_mode: 'HTML', ...getTranslationButtons() });
                }
            } else {
                let pCap = htmlCaption + `\n\n🧩 <b>Part ${i + 1}</b>`;
                if (type === 'audio') await ctx.replyWithAudio({ source: file }, { caption: pCap, parse_mode: 'HTML' });
                else await ctx.replyWithVideo({ source: file }, { caption: pCap, parse_mode: 'HTML' });
            }
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        if (ctx.from?.id) db.incrementDownloads(ctx.from.id);

    } catch (e) {
        console.error("CRITICAL ERROR:", e);
        try { await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, `❌ Error: ${e.message.substring(0, 50)}`, { parse_mode: 'HTML' }); } catch (err) {}
        if (basePath) { 
            ['.mp4', '.jpg', '.mp3'].forEach(ex => { if (fs.existsSync(basePath+ex)) fs.unlinkSync(basePath+ex); }); 
        }
    }
};

const handleMessage = async (ctx) => {
    db.addUser(ctx);
    const messageText = ctx.message.text;
    if (!messageText) return; 
    const match = messageText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    const parts = messageText.split(inputUrl);
    const postText = parts[1]?.trim(); 
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(inputUrl);
        let media = null;
        let platformName = 'Social';

        // ✅ টুইটার লজিক: ভিডিও ফার্স্ট চেক
        if (fullUrl.includes('x.com') || fullUrl.includes('twitter.com')) {
            platformName = 'Twitter';
            try {
                const info = await downloader.getInfo(fullUrl); 
                if (info.duration || (info.formats && info.formats.some(f => f.vcodec !== 'none'))) {
                    media = { title: info.title, author: info.uploader, source: fullUrl, type: 'video', thumbnail: info.thumbnail, formats: info.formats || [] };
                } else {
                    media = await twitterService.extract(fullUrl);
                }
            } catch (e) {
                media = await twitterService.extract(fullUrl);
            }
        } 
        else if (fullUrl.includes('reddit.com')) {
            media = await redditService.extract(fullUrl);
            platformName = 'Reddit';
        } else {
            try {
                const info = await downloader.getInfo(fullUrl);
                media = { title: info.title, author: info.uploader, source: fullUrl, type: 'video', thumbnail: info.thumbnail, formats: info.formats || [] };
            } catch (e) { media = { title: 'Media', author: 'User', source: fullUrl, type: 'video' }; }
        }

        if (!media) throw new Error("Media not found");

        const prettyCaption = generateCaption(postText || media.title, platformName, media.source, '🇧🇩');
        const buttons = [];
        if (media.type === 'video') {
            if (media.formats) {
                const fmts = media.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height);
                const seen = new Set();
                fmts.slice(0, 5).forEach(f => { if(!seen.has(f.height)) { seen.add(f.height); buttons.push([Markup.button.callback(`📹 ${f.height}p`, `vid|${f.format_id}`)]); } });
            }
            buttons.push([Markup.button.callback("📹 Video (Best)", "vid|best")], [Markup.button.callback("🎵 Audio", "aud|best")]);
        }
        else if (media.type === 'gallery') buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        else if (media.type === 'image') buttons.push([Markup.button.callback(`🖼 Download Image`, `img|single`)]);

        const menu = Markup.inlineKeyboard([...buttons, ...getTranslationButtons().reply_markup.inline_keyboard]);
        if (media.thumbnail) {
            await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
            await ctx.replyWithPhoto(media.thumbnail, { caption: prettyCaption, parse_mode: 'HTML', ...menu });
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, prettyCaption, { parse_mode: 'HTML', ...menu });
        }
    } catch (e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed: " + e.message); }
};

const handleCallback = async (ctx) => {
    db.addUser(ctx);
    const [action, id] = ctx.callbackQuery.data.split('|');
    if (action === 'help_msg') return handleHelp(ctx);
    if (action === 'start_msg') return handleStart(ctx);
    
    const entities = ctx.callbackQuery.message.caption_entities || ctx.callbackQuery.message.entities;
    const url = entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("Expired. Send link again.");

    let type = action === 'aud' ? 'audio' : (action === 'img' ? 'image' : (action === 'alb' ? 'gallery' : 'video'));
    await performDownload(ctx, url, type, id, ctx.callbackQuery.message.message_id, ctx.callbackQuery.message.caption, null);
};

const handleGroupMessage = async (ctx, next) => {
    if (ctx.message?.text?.startsWith('/setnick')) {
        const p = ctx.message.text.split(' ');
        if (p.length < 2 || !ctx.message.reply_to_message) return ctx.reply("Reply + /setnick name");
        await db.setNickname(ctx.chat.id, p[1].toLowerCase(), ctx.message.reply_to_message.from.id);
        return ctx.reply("✅ Saved!");
    }
    return next();
};

module.exports = { handleMessage, handleCallback, handleGroupMessage, handleStart, handleHelp, performDownload, handleConfig, handleEditCaption };
