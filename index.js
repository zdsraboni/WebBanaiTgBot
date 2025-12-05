require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const axios = require('axios');

const execPromise = util.promisify(exec);

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

// MATCHING USER-AGENT (Crucial: Must match your Android Browser)
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const bot = new Telegraf(BOT_TOKEN);
const app = express();

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

// --- 1. COOKIE LOADER & REPAIR ---
const cookiePath = path.join(__dirname, 'cookies.txt');
if (process.env.REDDIT_COOKIES) {
    let rawData = process.env.REDDIT_COOKIES;
    
    // Fix 1: Restore newlines lost by Render
    rawData = rawData.replace(/\\n/g, '\n').replace(/ /g, '\t'); 
    
    // Fix 2: Clean up the #HttpOnly_ prefix which sometimes confuses yt-dlp
    // We replace "#HttpOnly_" with nothing, effectively uncommenting it for usage
    rawData = rawData.replace(/#HttpOnly_/g, '');

    // Fix 3: Ensure Header exists
    if (!rawData.startsWith('# Netscape')) {
        rawData = "# Netscape HTTP Cookie File\n" + rawData;
    }

    fs.writeFileSync(cookiePath, rawData);
    console.log("✅ Cookies loaded & User-Agent sync prepared.");
}

// --- 2. MIRRORS (Backup) ---
const MIRRORS = [
    'https://redlib.catsarch.com',
    'https://redlib.vlingit.com',
    'https://libreddit.kavin.rocks'
];

const URL_REGEX = /(https?:\/\/(?:www\.|old\.|mobile\.)?(?:reddit\.com|x\.com|twitter\.com)\/[^\s]+)/i;

// --- UTILITIES ---

const resolveRedirect = async (shortUrl) => {
    if (!shortUrl.includes('/s/')) return shortUrl;
    try {
        const res = await axios.head(shortUrl, {
            maxRedirects: 0,
            validateStatus: (s) => s >= 300 && s < 400,
            headers: { 'User-Agent': USER_AGENT }
        });
        return res.headers.location || shortUrl;
    } catch (e) { return shortUrl; }
};

const runYtDlp = async (url) => {
    // We force the Android User-Agent here
    let cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist --user-agent "${USER_AGENT}" -J "${url}"`;
    if (fs.existsSync(cookiePath)) cmd += ` --cookies "${cookiePath}"`;
    return await execPromise(cmd);
};

const getMirrorLink = async (fullUrl) => {
    try {
        const parsed = new URL(fullUrl);
        const cleanPath = parsed.pathname; 
        for (const domain of MIRRORS) {
            try {
                // Mirrors often fail on NSFW content, but we try anyway
                const { data } = await axios.get(`${domain}${cleanPath}.json`, { 
                    timeout: 4000,
                    headers: { 'User-Agent': USER_AGENT } 
                });
                const post = data[0].data.children[0].data;
                if (post.is_video && post.media?.reddit_video) {
                    return { 
                        title: post.title, 
                        url: post.media.reddit_video.fallback_url.split('?')[0],
                        is_video: true 
                    };
                }
            } catch (e) { continue; }
        }
    } catch (e) { }
    return null;
};

const downloadMedia = async (url, isAudio, formatId, outputPath) => {
    let cmd = `yt-dlp --force-ipv4 --no-warnings --user-agent "${USER_AGENT}"`;
    if (fs.existsSync(cookiePath)) cmd += ` --cookies "${cookiePath}"`;

    if (isAudio) {
        cmd += ` -x --audio-format mp3 -o "${outputPath}.%(ext)s" "${url}"`;
    } else {
        const fmt = formatId === 'best' ? 'best' : `${formatId}+bestaudio/best`;
        cmd += ` -f "${fmt}" --merge-output-format mp4 -o "${outputPath}.%(ext)s" "${url}"`;
    }
    return await execPromise(cmd);
};

// --- HANDLERS ---

bot.start((ctx) => ctx.reply("👋 Ready! Android Mode Active."));

bot.on('text', async (ctx) => {
    const match = ctx.message.text.match(URL_REGEX);
    if (!match) return;

    const msg = await ctx.reply("🔍 *Verifying Credentials...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const originalUrl = match[0];
        let fullUrl = await resolveRedirect(originalUrl);
        
        // Clean tracking params
        try { const u = new URL(fullUrl); u.search = ""; fullUrl = u.toString(); } catch(e) {}

        let info = {};
        let downloadUrl = fullUrl;

        // STRATEGY: Main Site with Android Cookies
        try {
            const { stdout } = await runYtDlp(fullUrl);
            info = JSON.parse(stdout);
            console.log("✅ Fetched via Cookies");
        } catch (err) {
            console.log("⚠️ Cookies rejected. Trying Mirror...");
            if (fullUrl.includes('reddit.com')) {
                const mirrorData = await getMirrorLink(fullUrl);
                if (mirrorData) {
                    info = { title: mirrorData.title, formats: [], extractor_key: 'Mirror' };
                    downloadUrl = mirrorData.url;
                } else {
                    // One last try: Force v.redd.it detection if possible
                    if(err.stderr && err.stderr.includes('NSFW')) {
                        throw new Error("NSFW Content blocked. Verify account settings.");
                    }
                    throw err;
                }
            } else { throw err; }
        }

        // Buttons
        const buttons = [];
        if (info.formats && info.formats.length > 0) {
            const formats = info.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height);
            const seen = new Set();
            formats.slice(0, 5).forEach(f => {
                if(!seen.has(f.height)) {
                    seen.add(f.height);
                    buttons.push([Markup.button.callback(`📹 ${f.height}p`, `v|${f.format_id}|${f.height}`)]);
                }
            });
        }
        if (buttons.length === 0) buttons.push([Markup.button.callback("📹 Download Video", `v|best|best`)]);
        buttons.push([Markup.button.callback("🎵 Audio Only", "a|best|audio")]);

        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            `✅ *${(info.title || 'Media Found').substring(0, 50)}...*\nSource: [Link](${downloadUrl})`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

    } catch (err) {
        console.error("Handler Error:", err.message);
        let text = "❌ Failed.";
        if (err.message.includes('403')) text = "❌ Access Denied. Reddit rejected the cookies.";
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text);
    }
});

bot.on('callback_query', async (ctx) => {
    const [type, id, label] = ctx.callbackQuery.data.split('|');
    const url = ctx.callbackQuery.message.entities?.find(e => e.type === 'text_link')?.url;
    if (!url) return ctx.answerCbQuery("❌ Link expired.");

    await ctx.answerCbQuery("🚀 Downloading...");
    await ctx.editMessageText(`⏳ *Downloading...*`, { parse_mode: 'Markdown' });

    const timestamp = Date.now();
    const basePath = path.join(downloadDir, `${timestamp}`);
    const finalFile = `${basePath}.${type === 'a' ? 'mp3' : 'mp4'}`;

    try {
        await downloadMedia(url, type === 'a', id, basePath);
        
        const stats = fs.statSync(finalFile);
        if (stats.size > 49.5 * 1024 * 1024) {
            await ctx.editMessageText("⚠️ File > 50MB.");
        } else {
            await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
            type === 'a' 
                ? await ctx.replyWithAudio({ source: finalFile })
                : await ctx.replyWithVideo({ source: finalFile });
            await ctx.deleteMessage();
        }
    } catch (e) {
        console.error("DL Error:", e);
        await ctx.editMessageText("❌ Download Error.");
    } finally {
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
});

app.get('/', (req, res) => res.send('✅ Bot Online (Android Mode)'));
if (process.env.NODE_ENV === 'production') {
    app.use(bot.webhookCallback('/bot'));
    bot.telegram.setWebhook(`${APP_URL}/bot`);
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on ${PORT}`));
} else {
    bot.launch();
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
