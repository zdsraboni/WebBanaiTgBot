require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express'); // NEW: Web server
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express(); // Initialize web server

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

const URL_REGEX = /(https?:\/\/(?:www\.|old\.|mobile\.)?(?:reddit\.com|x\.com|twitter\.com)\/[^\s]+)/i;

// --- UTILITIES ---

// 1. Robust Link Resolver (Uses Linux curl instead of JS fetch)
// This fixes the "403 Blocked" when trying to expand /s/ links
const resolveToOldReddit = async (url) => {
    try {
        console.log("🔄 Resolving link:", url);
        
        // Step A: If it's a short link (/s/), use curl to follow redirect
        let longUrl = url;
        if (url.includes('/s/')) {
            // We use curl -I (headers only) -L (follow redirects) -w (write out effective url)
            const curlCmd = `curl -s -L -I -w "%{url_effective}" -o /dev/null -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" "${url}"`;
            const { stdout } = await execPromise(curlCmd);
            longUrl = stdout.trim();
        }

        // Step B: Clean tracking parameters
        const urlObj = new URL(longUrl);
        urlObj.search = ''; // Remove ?share_id=...

        // Step C: FORCE "old.reddit.com"
        // This is the secret sauce. Old reddit has fewer security blocks.
        if (urlObj.hostname.includes('reddit.com')) {
            urlObj.hostname = 'old.reddit.com';
        }

        console.log("✅ Final URL:", urlObj.toString());
        return urlObj.toString();

    } catch (e) {
        console.error("Resolution failed:", e);
        return url; // Fail safe to original
    }
};

const runYtDlp = async (args) => {
    // We use a specific User-Agent that works well with Old Reddit
    const cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist --add-header "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0" ${args}`;
    const { stdout } = await execPromise(cmd);
    return stdout;
};

const formatBytes = (bytes) => {
    if (!+bytes) return 'Unknown';
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${['B','KB','MB','GB'][i]}`;
};

// --- BOT LOGIC ---

bot.start((ctx) => ctx.reply("👋 Bot Online! Send me a link."));

bot.on('text', async (ctx) => {
    const match = ctx.message.text.match(URL_REGEX);
    if (!match) return;

    const msg = await ctx.reply("🔍 *Processing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        // 1. Resolve and Convert to Old Reddit
        const url = await resolveToOldReddit(match[0]);

        // 2. Get Metadata
        const jsonOutput = await runYtDlp(`-J "${url}"`);
        const info = JSON.parse(jsonOutput);

        // 3. Process Formats
        const formats = (info.formats || []).filter(f => f.ext === 'mp4' && f.height);
        const uniqueQualities = [];
        const seenHeights = new Set();
        formats.sort((a, b) => b.height - a.height);

        for (const fmt of formats) {
            if (!seenHeights.has(fmt.height)) {
                seenHeights.add(fmt.height);
                uniqueQualities.push({ h: fmt.height, id: fmt.format_id });
            }
        }

        const buttons = [];
        uniqueQualities.slice(0, 5).forEach(q => {
            buttons.push([Markup.button.callback(`📹 ${q.h}p`, `v|${q.h}|${q.id}`)]);
        });
        buttons.push([Markup.button.callback("🎵 Audio", "a|mp3|mp3")]);

        // Store URL hidden in text
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            `✅ *${info.title.substring(0, 50)}...*\nSource: [Link](${url})`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

    } catch (err) {
        console.error(err);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. If this is a NSFW post, Reddit might be blocking server access.");
    }
});

bot.on('callback_query', async (ctx) => {
    const [type, label, id] = ctx.callbackQuery.data.split('|');
    
    // Extract URL from message entity
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Link expired.");

    await ctx.answerCbQuery("🚀 Downloading...");
    await ctx.editMessageText(`⏳ *Downloading ${label}...*`, { parse_mode: 'Markdown' });

    const timestamp = Date.now();
    const basePath = path.join(downloadDir, `${timestamp}`);
    let finalFile = `${basePath}.${type === 'a' ? 'mp3' : 'mp4'}`;

    try {
        const cmd = type === 'a' 
            ? `-x --audio-format mp3 -o "${basePath}.%(ext)s" "${url}"`
            : `-f ${id}+bestaudio/best -S vcodec:h264 --merge-output-format mp4 -o "${basePath}.%(ext)s" "${url}"`;
            
        await runYtDlp(cmd);

        const stats = fs.statSync(finalFile);
        if (stats.size > 49.5 * 1024 * 1024) {
            await ctx.editMessageText(`⚠️ File too big (${(stats.size/1024/1024).toFixed(1)}MB). Limit is 50MB.`);
        } else {
            await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
            type === 'a' 
                ? await ctx.replyWithAudio({ source: finalFile }, { caption: '🎵 Audio' })
                : await ctx.replyWithVideo({ source: finalFile }, { caption: `🎥 ${label}p` });
            await ctx.deleteMessage();
        }
    } catch (e) {
        console.error(e);
        await ctx.editMessageText("❌ Download Error.");
    } finally {
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
});

// --- SERVER SETUP (Fixes the "Access Denied" Website Error) ---

// 1. Basic Home Page
app.get('/', (req, res) => {
    res.send('✅ Bot is running perfectly! Go to Telegram to use it.');
});

// 2. Launch Bot
if (process.env.NODE_ENV === 'production') {
    // Set up Webhook via Express
    app.use(bot.webhookCallback('/bot')); 
    bot.telegram.setWebhook(`${URL}/bot`);
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🔗 Webhook set to ${URL}/bot`);
    });
} else {
    bot.launch();
}

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
