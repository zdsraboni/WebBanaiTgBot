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

// --- 1. HELPERS ---
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

// --- 2. CORE DOWNLOAD EXECUTION ---
const performDownload = async (ctx, url, isAudio, qualityId, botMsgId, captionText) => {
    let finalFile = "";
    try {
        // Status Update
        await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, "⏳ <b>Downloading to server...</b>", { parse_mode: 'HTML' }).catch(()=>{});

        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;

        await downloader.download(url, isAudio, qualityId, basePath);
        
        if (fs.existsSync(finalFile)) {
            const stats = fs.statSync(finalFile);
            // 50MB Split Logic
            if (!isAudio && stats.size > 49.5 * 1024 * 1024) {
                await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, "⚠️ <b>File > 50MB. Splitting into parts...</b>", { parse_mode: 'HTML' }).catch(()=>{});
                const parts = await downloader.splitFile(finalFile);
                for (let i = 0; i < parts.length; i++) {
                    await ctx.replyWithVideo({ source: parts[i] }, { caption: `${captionText}\n\n🧩 <b>Part ${i + 1}</b>`, parse_mode: 'HTML' });
                    if (fs.existsSync(parts[i])) fs.unlinkSync(parts[i]);
                }
            } else {
                const mediaExtra = { caption: captionText, parse_mode: 'HTML', ...getTranslationButtons() };
                isAudio ? await ctx.replyWithAudio({ source: finalFile }, mediaExtra) : await ctx.replyWithVideo({ source: finalFile }, mediaExtra);
            }
            
            // Clean up
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
            await ctx.telegram.deleteMessage(ctx.chat.id, botMsgId).catch(()=>{});
            db.incrementDownloads(ctx.from?.id);
        } else {
            throw new Error("File download failed on server.");
        }
    } catch (e) {
        console.error("Download Error:", e);
        await ctx.telegram.editMessageCaption(ctx.chat.id, botMsgId, null, `❌ <b>Download Failed:</b> ${e.message.substring(0, 50)}`, { parse_mode: 'HTML' }).catch(()=>{});
        if (finalFile && fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
};

// --- 3. MAIN MESSAGE HANDLER ---
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

        // Platform Detection & Scraping
        if (fullUrl.includes('twitter.com') || fullUrl.includes('x.com')) {
            platform = "Twitter";
            try {
                const info = await downloader.getInfo(fullUrl);
                media = { title: info.title, source: fullUrl, type: info.is_image ? 'image' : 'video', url: info.url, thumbnail: info.thumbnail };
            } catch (e) { 
                media = { title: "Twitter Media", source: fullUrl, type: 'image', url: fullUrl.replace('x.com', 'vxtwitter.com').replace('twitter.com', 'vxtwitter.com') };
            }
        } else if (fullUrl.includes('reddit.com')) {
            platform = "Reddit";
            media = await redditService.extract(fullUrl);
        } else {
            const info = await downloader.getInfo(fullUrl);
            media = { title: info.title, source: fullUrl, type: 'video', url: fullUrl, thumbnail: info.thumbnail };
        }

        const caption = generateCaption(postText || media.title, platform, fullUrl, '🇧🇩');
        const buttons = media.type === 'video' ? [[Markup.button.callback("📹 Video", `vid|best`), Markup.button.callback("🎵 Audio", `aud|best`)]] : [[Markup.button.callback("🖼 Download Image", `img|single`)]];
        const markup = Markup.inlineKeyboard([...buttons, ...getTranslationButtons().reply_markup.inline_keyboard]);

        // Fix: Don't delete "Analyzing" until next step is ready
        if (media.type === 'image') {
            const imgPath = path.join(config.DOWNLOAD_DIR, `img_${Date.now()}.jpg`);
            await downloader.downloadGeneric(media.url, imgPath);
            await ctx.replyWithPhoto({ source: imgPath }, { caption, parse_mode: 'HTML', ...markup });
            await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, caption, { parse_mode: 'HTML', ...markup });
        }
    } catch (e) { 
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ <b>Error:</b> Media not found or private.", { parse_mode: 'HTML' }).catch(()=>{}); 
    }
};

// --- 4. SYSTEM HANDLERS ---
const handleStart = async (ctx) => {
    db.addUser(ctx);
    const text = `👋 <b>Welcome Zd!</b>\nTwitter, Reddit, Instagram & TikTok support ✅\n\n• /caption (Reply to bot to edit)\n• /setnick (Group nicknames)`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('📚 Help', 'help_msg'), Markup.button.callback('📊 Stats', 'stats_msg')]]);
    ctx.callbackQuery ? await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{}) : await ctx.reply(text, { parse_mode: 'HTML', ...buttons });
};

const handleHelp = async (ctx) => {
    const text = `📚 <b>Help Guide</b>\n1. Send link\n2. /caption [text] (Reply to bot message)\n3. /setnick [name] (Reply to user in groups)`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'start_msg')]]);
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
};

const handleEditCaption = async (ctx) => {
    const text = ctx.message.text;
    if (!text?.startsWith('/caption') || !ctx.message.reply_to_message) return false;
    const newCaption = text.replace(/^\/caption\s*/, '').trim();
    if (!newCaption) return true;
    try {
        await ctx.telegram.editMessageCaption(ctx.chat.id, ctx.message.reply_to_message.message_id, null, newCaption, { 
            parse_mode: 'HTML', 
            reply_markup: ctx.message.reply_to_message.reply_markup 
        });
        await ctx.deleteMessage().catch(()=>{});
    } catch (e) { console.error("Edit Error:", e.message); }
    return true;
};

const handleGroupMessage = async (ctx, next) => {
    if (!ctx.message?.text) return next();
    const text = ctx.message.text;
    if (text.startsWith('/setnick')) {
        const parts = text.split(' ');
        if (parts.length < 2 || !ctx.message.reply_to_message) return ctx.reply("Usage: Reply + /setnick name");
        await db.setNickname(ctx.chat.id, parts[1].toLowerCase(), ctx.message.reply_to_message.from.id);
        return ctx.reply("✅ Nickname Saved!");
    }
    const nick = await db.getNickname(ctx.chat.id, text.trim().toLowerCase());
    if (nick) return ctx.reply(`👋 <b>${ctx.from.first_name}</b> mentioned <a href="tg://user?id=${nick.targetId}">User</a>`, { parse_mode: 'HTML' });
    return next();
};

const handleConfig = async (ctx) => {
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;
    const text = ctx.message.text;
    if (text.startsWith('/set_destination')) {
        let targetId = text.includes('reset') ? "" : ctx.chat.id;
        await db.setWebhookTarget(config.ADMIN_ID, targetId);
        return ctx.reply("✅ Webhook Target Updated.");
    }
    if (text.startsWith('/mode')) {
        const mode = text.split(' ')[1];
        await db.toggleMode(ctx.from.id, mode);
        return ctx.reply(`🔄 Mode: ${mode}`);
    }
};

const handleCallback = async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split('|');
    if (action === 'help_msg') return handleHelp(ctx);
    if (action === 'start_msg') return handleStart(ctx);
    
    const entities = ctx.callbackQuery.message.caption_entities || ctx.callbackQuery.message.entities;
    const url = entities?.find(e => e.type === 'text_link')?.url;

    if (action === 'trans') {
        const body = ctx.callbackQuery.message.caption.split('\n').slice(2).join('\n');
        if (!body) return ctx.answerCbQuery("No text to translate");
        const res = await translate(body, { to: id });
        return ctx.editMessageCaption(generateCaption(res.text, 'Social', url || 'source', '🇧🇩'), { parse_mode: 'HTML', ...getTranslationButtons() });
    }

    if (!url) return ctx.answerCbQuery("❌ Link expired. Send again.");

    if (action === 'vid' || action === 'aud') {
        await ctx.answerCbQuery("🚀 Processing...");
        await performDownload(ctx, url, action === 'aud', id, ctx.callbackQuery.message.message_id, ctx.callbackQuery.message.caption);
    } else if (action === 'img') {
        await ctx.answerCbQuery("Sending...");
        const imgPath = path.join(config.DOWNLOAD_DIR, `img_${Date.now()}.jpg`);
        await downloader.downloadGeneric(url, imgPath);
        await ctx.replyWithPhoto({ source: imgPath });
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        await ctx.deleteMessage().catch(()=>{});
    }
};

// --- 5. EXPORTS ---
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
