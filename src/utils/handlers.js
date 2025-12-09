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

// --- START & HELP HANDLERS (PROFESSIONAL UI) ---
const handleStart = async (ctx) => {
    if (ctx.from) db.addUser(ctx.from.id);
    
    const text = `
👋 <b>Welcome to Media Banai!</b>

I am a professional media downloader bot. 
I can download high-quality videos and images from:
• 🐦 <b>Twitter / X</b>
• 👽 <b>Reddit</b>

<b>🚀 Features:</b>
• 🎬 Auto-Download (Highest Quality)
• 🗣 Smart Translation (Eng/Ban)
• 👻 Ghost Mentions (Group Nicknames)
• 📝 Custom Captions & Flags

<i>Just send me a link to get started!</i>
    `.trim();

    const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('📚 How to Use', 'help_msg'), Markup.button.callback('📊 Bot Stats', 'stats_msg')],
        [Markup.button.url('📣 Updates Channel', 'https://t.me/MediaBanaiUpdates')] // Replace with your channel or remove
    ]);

    // If called via callback (Back button), edit message. Else send new.
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', ...buttons });
    }
};

const handleHelp = async (ctx) => {
    const text = `
📚 <b>Media Banai Help Guide</b>

<b>1. 📥 Downloading Media</b>
Simply send any valid link from Twitter(X) or Reddit.
• I will analyze it and provide download buttons.
• If "Quality Check" fails, I auto-download the best version.

<b>2. 📝 Custom Captions</b>
• Write text after the link to set a custom caption.
• <i>Ex:</i> <code>https://x.com/post Wow this is cool!</code>
• Add country code (us, bd, in) before link for flags.
• <i>Ex:</i> <code>bd https://x.com/post</code>

<b>3. 👻 Ghost Mentions (Groups)</b>
<i>(Reply to a user in a group)</i>
• <code>/setnick bro</code> - Saves "bro" for that user.
• Type <b>bro</b> - Bot deletes text & tags user.
• <code>/delnick bro</code> - Deletes nickname.

<b>4. 🗣 Translation</b>
• Use the 🇺🇸/🇧🇩 buttons below media to translate captions.
    `.trim();

    const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Back to Menu', 'start_msg')]
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
    }
};

// --- SHARED DOWNLOAD FUNCTION ---
const performDownload = async (ctx, url, isAudio, qualityId, botMsgId, captionText, userMsgId) => {
    try {
        if (userMsgId) { try { await ctx.telegram.deleteMessage(ctx.chat.id, userMsgId); } catch (err) {} }

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
        
        const extraOptions = { 
            caption: captionText || '🚀 Downloaded via Media Banai',
            parse_mode: 'HTML',
            ...getTranslationButtons()
        };

        if (isAudio) await ctx.replyWithAudio({ source: finalFile }, extraOptions);
        else await ctx.replyWithVideo({ source: finalFile }, extraOptions);

        db.incrementDownloads(); // Track stats

        console.log(`✅ Upload Success: ${url}`);
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
    if (ctx.from && ctx.from.id) db.addUser(ctx.from.id);

    const messageText = ctx.message.text;
    if (!messageText) return; 

    const match = messageText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    const parts = messageText.split(inputUrl);
    const preText = parts[0].trim(); 
    const postText = parts[1].trim(); 

    let flagEmoji = '🇧🇩';
    if (preText.length === 2 && /^[a-zA-Z]+$/.test(preText)) {
        flagEmoji = getFlagEmoji(preText);
    }

    const userCustomCaption = postText; 
    console.log(`📩 Request: ${inputUrl} | Flag: ${flagEmoji}`);
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
            console.log("⚠️ No resolutions found. Auto-Downloading.");
            return await performDownload(ctx, safeUrl, false, 'best', msg.message_id, prettyCaption, ctx.message.message_id);
        }

        const buttons = [];
        let previewText = `✅ ${flagEmoji} *${finalTitleText.substring(0, 50)}...*`;

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

// --- GROUP HANDLER ---
const handleGroupMessage = async (ctx, next) => {
    const messageText = ctx.message.text;
    
    if (messageText && messageText.startsWith('/setnick')) {
        const parts = messageText.split(' ');
        if (parts.length < 2) return ctx.reply("⚠️ Usage: Reply to a user and type: /setnick <name>");
        const nickName = parts[1].toLowerCase();
        if (!ctx.message.reply_to_message) return ctx.reply("⚠️ You must reply to the user you want to nickname.");
        
        await db.setNickname(ctx.chat.id, nickName, ctx.message.reply_to_message.from.id);
        return ctx.reply(`✅ Nickname set! Type <b>${nickName}</b> to mention user.`, { parse_mode: 'HTML' });
    }

    if (messageText && messageText.startsWith('/delnick')) {
        const parts = messageText.split(' ');
        if (parts.length < 2) return;
        await db.deleteNickname(ctx.chat.id, parts[1]);
        return ctx.reply(`🗑 Nickname '${parts[1]}' deleted.`);
    }

    if (messageText) {
        const cleanText = messageText.trim().toLowerCase();
        const nickEntry = await db.getNickname(ctx.chat.id, cleanText);
        if (nickEntry) {
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply(`👋 <b>${ctx.from.first_name}</b> mentioned <a href="tg://user?id=${nickEntry.targetId}">User</a>`, { parse_mode: 'HTML' });
            return; 
        }
    }
    return next();
};

// --- ADMIN HANDLER ---
const handleAdmin = async (ctx) => {
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;
    const command = ctx.message.text.split(' ')[0];

    if (command === '/stats') {
        const stats = await db.getStats();
        return ctx.reply(`📊 <b>Stats</b>\n👤 Users: ${stats.users}\n⬇️ Downloads: ${stats.downloads}`, { parse_mode: 'HTML' });
    }
    if (command === '/broadcast') {
        const message = ctx.message.text.replace('/broadcast', '').trim();
        if (!message) return ctx.reply("⚠️ Usage: /broadcast [Message]");
        const users = await db.getAllUsers();
        await ctx.reply(`📢 Sending to ${users.length} users...`);
        let s = 0;
        for (const u of users) { try { await ctx.telegram.sendMessage(u, message); s++; } catch(e){} }
        return ctx.reply(`✅ Sent to ${s} users.`);
    }
};

// --- CALLBACK HANDLER ---
const handleCallback = async (ctx) => {
    if (ctx.from && ctx.from.id) db.addUser(ctx.from.id);
    const data = ctx.callbackQuery.data;
    const [action, id] = data.split('|');
    
    // UI NAVIGATION
    if (action === 'help_msg') return handleHelp(ctx);
    if (action === 'start_msg') return handleStart(ctx);
    if (action === 'stats_msg') {
        const stats = await db.getStats();
        return ctx.answerCbQuery(`📊 Users: ${stats.users} | Downloads: ${stats.downloads}`, { show_alert: true });
    }

    // TRANSLATE
    if (action === 'trans') {
        const targetLang = id; 
        const messageCaption = ctx.callbackQuery.message.caption;
        if (!messageCaption) return ctx.answerCbQuery("No text.");
        await ctx.answerCbQuery(targetLang === 'bn' ? "🇧🇩 Translating..." : "🇺🇸 Translating...");

        let currentFlag = '🇧🇩'; 
        const sourceLine = messageCaption.split('\n')[0]; 
        const flagMatch = sourceLine.match(/source\s+(.+)$/); 
        if (flagMatch && flagMatch[1]) currentFlag = flagMatch[1].trim(); 

        const entities = ctx.callbackQuery.message.caption_entities;
        const linkEntity = entities?.find(e => e.type === 'text_link');
        const sourceUrl = linkEntity ? linkEntity.url : "https://google.com";
        
        let platform = 'Social';
        if (messageCaption.toLowerCase().includes('twitter')) platform = 'Twitter';
        else if (messageCaption.toLowerCase().includes('reddit')) platform = 'Reddit';

        const lines = messageCaption.split('\n');
        let contentToTranslate = messageCaption;
        if (lines.length > 2) contentToTranslate = lines.slice(2).join('\n').trim();

        try {
            const res = await translate(contentToTranslate, { to: targetLang, autoCorrect: true });
            const newCaption = generateCaption(res.text, platform, sourceUrl, currentFlag);
            await ctx.editMessageCaption(newCaption, { parse_mode: 'HTML', ...getTranslationButtons() });
        } catch (e) {
            await ctx.answerCbQuery("❌ Translation failed.");
        }
        return;
    }

    // DOWNLOAD
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Link expired.");

    let platformName = 'Social';
    if (url.includes('twitter') || url.includes('x.com')) platformName = 'Twitter';
    else if (url.includes('reddit')) platformName = 'Reddit';

    let titleToUse = "Media Content";
    let flagToUse = '🇧🇩';
    const msgText = ctx.callbackQuery.message.text;
    if (msgText) {
        const firstLine = msgText.split('\n')[0]; 
        const content = firstLine.replace('✅ ', '');
        const parts = content.split(' ');
        if (parts.length > 0 && /\p{Emoji}/u.test(parts[0])) {
            flagToUse = parts[0];
            titleToUse = parts.slice(1).join(' '); 
        } else {
            titleToUse = content; 
        }
    }

    const niceCaption = generateCaption(titleToUse, platformName, url, flagToUse);
    const userOriginalMsgId = ctx.callbackQuery.message.reply_to_message?.message_id;

    if (action === 'img') {
        await ctx.answerCbQuery("🚀 Sending...");
        try { 
            await ctx.replyWithPhoto(url, { caption: niceCaption, parse_mode: 'HTML', ...getTranslationButtons() });
            if(userOriginalMsgId) await ctx.telegram.deleteMessage(ctx.chat.id, userOriginalMsgId).catch(()=>{});
        } catch { 
            await ctx.replyWithDocument(url, { caption: niceCaption, parse_mode: 'HTML', ...getTranslationButtons() }); 
        }
        await ctx.deleteMessage();
    }
    else if (action === 'alb') {
        await ctx.answerCbQuery("🚀 Processing...");
        let media = null;
        if (url.includes('x.com') || url.includes('twitter')) media = await twitterService.extract(url);
        else media = await redditService.extract(url);

        if (media?.type === 'gallery') {
            await ctx.deleteMessage();
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
        await performDownload(ctx, url, action === 'aud', id, ctx.callbackQuery.message.message_id, niceCaption, userOriginalMsgId);
    }
};

module.exports = { handleMessage, handleCallback, handleAdmin, handleGroupMessage, handleStart, handleHelp };