require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const https = require('https');

const execPromise = util.promisify(exec);

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

// Match Reddit and X (Twitter) links
const URL_REGEX = /(https?:\/\/(?:www\.|old\.|mobile\.)?(?:reddit\.com|x\.com|twitter\.com)\/[^\s]+)/i;

// --- UTILITIES ---

// 1. Resolve Reddit Short Links & Clean Tracking Params
const resolveAndCleanLink = async (url) => {
    try {
        let finalUrl = url;

        // If it's a short link (/s/), resolve it first
        if (url.includes('/s/')) {
            console.log("🔄 Resolving short link:", url);
            const response = await fetch(url, {
                method: 'HEAD',
                redirect: 'manual',
                headers: {
                    // Pretend to be a mobile device to get the redirect
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36'
                }
            });

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (location) finalUrl = location;
            }
        }

        // Clean query parameters (remove ?share_id=..., ?utm=...)
        // Reddit blocks links with specific tracking IDs from bots
        const urlObj = new URL(finalUrl);
        urlObj.search = ''; // Remove everything after '?'
        return urlObj.toString();

    } catch (error) {
        console.error("Link cleaning failed:", error);
        return url;
    }
};

const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return 'Unknown';
    const k = 1024;
    const sizes = ['MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i] || 'Bytes'}`;
};

const runYtDlp = async (args) => {
    // FIX: Use the "Reddit Android App" User-Agent.
    // This is much less likely to be blocked on cloud servers than a Desktop Browser UA.
    const userAgent = 'Reddit/2023.14.0 (Android; 13; Mobile)';
    
    // --no-cache-dir: Prevents using cached tokens that might be expired/blocked
    const cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist --no-cache-dir --add-header "User-Agent:${userAgent}" ${args}`;
    
    const { stdout } = await execPromise(cmd);
    return stdout;
};

// --- BOT LOGIC ---

bot.start((ctx) => ctx.reply("👋 I'm ready! Send me a Reddit or Twitter link."));

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const match = text.match(URL_REGEX);
    if (!match) return;

    const msg = await ctx.reply("🔍 *Processing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        // 1. Clean the Link
        let url = await resolveAndCleanLink(match[0]);
        console.log("🎯 Using URL:", url);

        // 2. Fetch Info
        const jsonOutput = await runYtDlp(`-J "${url}"`);
        const info = JSON.parse(jsonOutput);

        // 3. Filter Qualities
        const formats = (info.formats || []).filter(f => f.ext === 'mp4' && f.height);
        
        // Deduplicate
        const uniqueQualities = [];
        const seenHeights = new Set();
        formats.sort((a, b) => b.height - a.height); // Highest first

        for (const fmt of formats) {
            if (!seenHeights.has(fmt.height)) {
                seenHeights.add(fmt.height);
                uniqueQualities.push({
                    height: fmt.height,
                    filesize: fmt.filesize || fmt.filesize_approx || 0,
                    id: fmt.format_id
                });
            }
        }

        const buttons = [];
        uniqueQualities.slice(0, 5).forEach(q => {
            buttons.push([Markup.button.callback(`📹 ${q.height}p`, `v|${q.height}|${q.id}`)]);
        });
        buttons.push([Markup.button.callback("🎵 Audio Only", "a|mp3|mp3")]);

        // Hide the clean URL in a Markdown link so we can grab it later
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            msg.message_id,
            null,
            `✅ *${info.title.substring(0, 50)}...*\n\nSource: [Link](${url})\nChoose quality:`,
            { 
                parse_mode: 'Markdown', 
                ...Markup.inlineKeyboard(buttons) 
            }
        );

    } catch (err) {
        console.error("Info Error:", err.stderr || err.message);
        let errorMsg = "❌ Failed. The link might be private.";
        if (err.stderr && err.stderr.includes('403')) {
            errorMsg = "❌ Reddit Refused connection. Try trying again in 1 minute.";
        }
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, errorMsg);
    }
});

bot.on('callback_query', async (ctx) => {
    const dataParts = ctx.callbackQuery.data.split('|');
    const type = dataParts[0];
    const label = dataParts[1];
    const formatId = dataParts[2];

    // Recover URL from the message entities (the hidden link we added)
    const entities = ctx.callbackQuery.message.entities || [];
    const linkEntity = entities.find(e => e.type === 'text_link');
    const url = linkEntity ? linkEntity.url : null;

    if (!url) return ctx.answerCbQuery("❌ Link lost. Please resend the link.");

    await ctx.answerCbQuery("🚀 Downloading...");
    await ctx.editMessageText(`⏳ *Downloading ${label}...*`, { parse_mode: 'Markdown' });

    const timestamp = Date.now();
    const basePath = path.join(downloadDir, `${timestamp}`);
    let finalFile;

    try {
        if (type === 'a') {
            finalFile = `${basePath}.mp3`;
            await runYtDlp(`-x --audio-format mp3 -o "${basePath}.%(ext)s" "${url}"`);
        } else {
            finalFile = `${basePath}.mp4`;
            // Download logic
            await runYtDlp(`-f ${formatId}+bestaudio/best -S vcodec:h264 --merge-output-format mp4 -o "${basePath}.%(ext)s" "${url}"`);
        }

        const stats = fs.statSync(finalFile);
        const sizeMB = stats.size / (1024 * 1024);

        if (sizeMB > 49.5) {
            await ctx.editMessageText(`⚠️ File is ${sizeMB.toFixed(1)}MB. Telegram limits bots to 50MB.`);
        } else {
            await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
            if (type === 'a') {
                await ctx.replyWithAudio({ source: finalFile }, { caption: '🎵 Audio' });
            } else {
                await ctx.replyWithVideo({ source: finalFile }, { caption: `🎥 ${label}p` });
            }
            await ctx.deleteMessage(); 
        }
    } catch (e) {
        console.error("Download Error:", e);
        await ctx.editMessageText("❌ Download failed.");
    } finally {
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
});

// --- DEPLOYMENT ---
if (process.env.NODE_ENV === 'production') {
    bot.launch({ webhook: { domain: URL, port: PORT } }).then(() => console.log(`🚀 Webhook: ${URL}`));
} else {
    bot.launch();
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
