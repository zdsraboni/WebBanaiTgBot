const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');
const { translate } = require('google-translate-api-x');
const db = require('./db'); // Import DB

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

        // TRACKING: Increment Download Count
        db.incrementDownloads();

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
    // TRACKING: Add User to DB
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

// --- ADMIN HANDLER (THIS WAS MISSING!) ---
const handleAdmin = async (ctx) => {
    // Security Check
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;

    const command = ctx.message.text.split(' ')[0];

    // 1. /stats
    if (command === '/stats') {
        const stats = await db.getStats(); // Await because DB is async now
        return ctx.reply(
            `📊 <b>Media Banai Stats</b>\n\n` +
            `👤 <b>Total Users:</b> ${stats.users}\n` +
            `⬇️ <b>Total Downloads:</b> ${stats.downloads}\n` +
            `🟢 <b>Server:</b> Online`,
            { parse_mode: 'HTML' }
        );
    }

    // 2. /broadcast <message>
    if (command === '/broadcast') {
        const message = ctx.message.text.replace('/broadcast', '').trim();
        if (!message) return ctx.reply("⚠️ Usage: /broadcast [Your Message]");

        const users = await db.getAllUsers();
        let success = 0;
        let blocked = 0;

        await ctx.reply(`📢 Starting broadcast to ${users.length} users...`);

        for (const userId of users) {
            try {
                await ctx.telegram.sendMessage(userId, `📢 <b>Admin Announcement</b>\n\n${message}`, { parse_mode: 'HTML' });
                success++;
                await new Promise(r => setTimeout(r, 50)); 
            } catch (e) {
                blocked++;
            }
        }

        return ctx.reply(`✅ Broadcast Complete.\n\nSent: ${success}\nFailed/Blocked: ${blocked}`);
    }
};

// --- CALLBACK HANDLER ---
const handleCallback = async (ctx) => {
    if (ctx.from && ctx.from.id) db.addUser(ctx.from.id);

    const data = ctx.callbackQuery.data;
    const [action, id] = data.split('|');
    
    // --- TRANSLATE ---
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

    // --- DOWNLOAD ---
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

// EXPORT ALL HANDLERS
module.exports = { handleMessage, handleCallback, handleAdmin };