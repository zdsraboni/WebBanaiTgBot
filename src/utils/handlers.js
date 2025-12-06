const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');

const { resolveRedirect } = require('./helpers'); 
const downloader = require('./downloader');
const redditService = require('../services/reddit');
const twitterService = require('../services/twitter');

// --- SHARED DOWNLOAD FUNCTION ---
// This handles the actual downloading and uploading logic
const performDownload = async (ctx, url, isAudio, qualityId, messageIdToEdit) => {
    try {
        // 1. Update status to Downloading
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            messageIdToEdit, 
            null, 
            `⏳ *Downloading...*\n_Please wait, this might take a moment._`, 
            { parse_mode: 'Markdown' }
        );

        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        const finalFile = `${basePath}.${isAudio ? 'mp3' : 'mp4'}`;

        console.log(`⬇️ Starting Download: ${url}`);
        
        // 2. Run the download
        await downloader.download(url, isAudio, qualityId, basePath);

        // 3. Check file size
        const stats = fs.statSync(finalFile);
        if (stats.size > 49.5 * 1024 * 1024) {
            await ctx.telegram.editMessageText(ctx.chat.id, messageIdToEdit, null, "⚠️ File > 50MB (Telegram Limit). Cannot upload.");
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
            return;
        }

        // 4. Upload
        await ctx.telegram.editMessageText(ctx.chat.id, messageIdToEdit, null, "📤 *Uploading...*", { parse_mode: 'Markdown' });
        
        if (isAudio) {
            await ctx.replyWithAudio({ source: finalFile }, { caption: '🎵 Audio extracted by Media Banai' });
        } else {
            await ctx.replyWithVideo({ source: finalFile }, { caption: '🚀 Downloaded via Media Banai' });
        }

        console.log(`✅ Upload Success: ${url}`);

        // 5. Cleanup: Delete the "Downloading..." message and the file
        await ctx.telegram.deleteMessage(ctx.chat.id, messageIdToEdit).catch(() => {});
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);

    } catch (e) {
        console.error(`Download Error: ${e.message}`);
        await ctx.telegram.editMessageText(ctx.chat.id, messageIdToEdit, null, "❌ Error during download/upload.");
        // Try cleanup
        const basePath = path.join(config.DOWNLOAD_DIR, `${Date.now()}`); // approximate path
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
        const inputUrl = match[0];
        const fullUrl = await resolveRedirect(inputUrl);
        let media = null;

        if (fullUrl.includes('x.com') || fullUrl.includes('twitter.com')) {
            media = await twitterService.extract(fullUrl);
        } else {
            media = await redditService.extract(fullUrl);
        }

        if (!media) throw new Error("Media not found");

        const safeUrl = media.url || media.source;

        // --- AUTO-DOWNLOAD LOGIC START ---
        // If it's a video BUT has no formats (Quality Check Failed), download immediately.
        if (media.type === 'video' && (!media.formats || media.formats.length === 0)) {
            console.log("⚠️ No resolutions found. Switching to Auto-Download.");
            // Directly call the download function using the "Analyzing..." message ID
            return await performDownload(ctx, safeUrl, false, 'best', msg.message_id);
        }
        // --- AUTO-DOWNLOAD LOGIC END ---

        // Normal Flow: Show Buttons
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
            // We only get here if formats exist (Success case)
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
            `${text}\nSource: [Link](${safeUrl})`,
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

    if (action === 'img') {
        await ctx.answerCbQuery("🚀 Sending...");
        try { await ctx.replyWithPhoto(url); } catch { await ctx.replyWithDocument(url); }
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
        // Video/Audio Download Button Clicked
        await ctx.answerCbQuery("🚀 Downloading...");
        // Pass the message ID of the menu so it gets edited to "Downloading..."
        await performDownload(ctx, url, action === 'aud', id, ctx.callbackQuery.message.message_id);
    }
};

module.exports = { handleMessage, handleCallback };