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
const URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express();

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

// --- MIRROR LIST ---
// If Reddit blocks Render, we ask these guys for the data instead.
const REDDIT_MIRRORS = [
    'https://redlib.catsarch.com',
    'https://redlib.vlingit.com',
    'https://redlib.tux.pizza',
    'https://libreddit.kavin.rocks',
    'https://old.reddit.com' // Last resort
];

// Regex for Links
const URL_REGEX = /(https?:\/\/(?:www\.|old\.|mobile\.)?(?:reddit\.com|x\.com|twitter\.com)\/[^\s]+)/i;

// --- CORE FUNCTIONS ---

// 1. Resolve Redirects (Fixes /s/ links)
const resolveUrl = async (shortUrl) => {
    if (!shortUrl.includes('/s/')) return shortUrl;
    try {
        // We use a simple HEAD request to get the real location
        const res = await axios.head(shortUrl, {
            maxRedirects: 0,
            validateStatus: (s) => s >= 300 && s < 400,
            headers: { 'User-Agent': 'Mozilla/5.0 (Android 10; Mobile; rv:68.0) Gecko/68.0 Firefox/68.0' }
        });
        return res.headers.location || shortUrl;
    } catch (e) {
        return shortUrl;
    }
};

// 2. The "Mirror" Bypass Strategy
const fetchMetadataFromMirrors = async (originalUrl) => {
    // Clean the URL path
    const urlObj = new URL(originalUrl);
    const path = urlObj.pathname; // e.g., /r/funny/comments/xyz/...

    // Try each mirror until one works
    for (const domain of REDDIT_MIRRORS) {
        try {
            const mirrorUrl = `${domain}${path}.json`;
            console.log(`🛡️ Trying Mirror: ${mirrorUrl}`);

            const { data } = await axios.get(mirrorUrl, {
                timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });

            // Extract Post Data
            const post = data[0].data.children[0].data;
            
            // Check if it's a video
            if (post.is_video && post.media && post.media.reddit_video) {
                return {
                    title: post.title,
                    // The fallback_url is usually the direct v.redd.it link
                    url: post.media.reddit_video.fallback_url.split('?')[0], 
                    is_video: true
                };
            } else if (post.url && post.url.includes('v.redd.it')) {
                 return { title: post.title, url: post.url, is_video: true };
            } else if (post.preview && post.preview.reddit_video_preview) {
                 return { title: post.title, url: post.preview.reddit_video_preview.fallback_url, is_video: true };
            }
        } catch (e) {
            console.log(`❌ Mirror ${domain} failed: ${e.message}`);
            continue; // Try next mirror
        }
    }
    return null; // All mirrors failed
};

// 3. Downloader
const runYtDlp = async (url) => {
    // We try to download. If it's a direct v.redd.it link, yt-dlp handles it perfectly even if Reddit blocks metadata.
    const cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist -J "${url}"`;
    return await execPromise(cmd);
};

// --- HANDLERS ---

bot.start((ctx) => ctx.reply("👋 Ready! Send me a link. I use mirrors to bypass blocks."));

bot.on('text', async (ctx) => {
    const match = ctx.message.text.match(URL_REGEX);
    if (!match) return;

    const msg = await ctx.reply("🔍 *Bypassing blocks...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        let targetUrl = await resolveUrl(match[0]);
        let info = null;
        let downloadUrl = targetUrl;

        // STRATEGY A: Try Direct (Might work for X.com/Twitter)
        if (targetUrl.includes('x.com') || targetUrl.includes('twitter.com')) {
            const { stdout } = await runYtDlp(targetUrl);
            info = JSON.parse(stdout);
        } else {
            // STRATEGY B: Reddit Mirror Bypass
            console.log("🕵️ Activating Reddit Mirror Bypass...");
            const mirrorData = await fetchMetadataFromMirrors(targetUrl);
            
            if (mirrorData) {
                console.log("✅ Found video via mirror:", mirrorData.url);
                downloadUrl = mirrorData.url; // This is the unblocked v.redd.it link
                info = {
                    title: mirrorData.title,
                    formats: [], // Dummy formats, we force 'best' later
                    extractor_key: 'RedditMirror'
                };
            } else {
                // If mirrors fail, try one last desperation attempts with yt-dlp direct
                const { stdout } = await runYtDlp(targetUrl);
                info = JSON.parse(stdout);
            }
        }

        // Build Buttons
        const buttons = [];
        if (info.formats && info.formats.length > 0) {
            // Standard selector for Twitter/X
            const formats = info.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height);
            const seen = new Set();
            formats.slice(0, 5).forEach(f => {
                if(!seen.has(f.height)) {
                    seen.add(f.height);
                    buttons.push([Markup.button.callback(`📹 ${f.height}p`, `v|${f.format_id}|${f.height}`)]);
                }
            });
        } else {
            // Fallback for Reddit (Since we got direct link)
            buttons.push([Markup.button.callback("📹 Download Video", `v|best|best`)]);
        }
        buttons.push([Markup.button.callback("🎵 Audio Only", "a|best|audio")]);

        // IMPORTANT: We store the safe 'downloadUrl' in the message
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            `✅ *${info.title.substring(0, 50)}...*\nSource: [Link](${downloadUrl})`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

    } catch (err) {
        console.error("Main Error:", err.message);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. All mirrors and direct access blocked.");
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
        let cmd;
        if (type === 'a') {
            cmd = `yt-dlp --force-ipv4 --no-warnings -x --audio-format mp3 -o "${basePath}.%(ext)s" "${url}"`;
        } else {
            // If it's a direct link (v.redd.it), 'best' is the safest option
            const fmt = id === 'best' ? 'best' : `${id}+bestaudio/best`;
            cmd = `yt-dlp --force-ipv4 --no-warnings -f "${fmt}" --merge-output-format mp4 -o "${basePath}.%(ext)s" "${url}"`;
        }

        await execPromise(cmd);

        const stats = fs.statSync(finalFile);
        if (stats.size > 49.5 * 1024 * 1024) {
            await ctx.editMessageText("⚠️ File > 50MB. Telegram limit.");
        } else {
            await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
            type === 'a' 
                ? await ctx.replyWithAudio({ source: finalFile })
                : await ctx.replyWithVideo({ source: finalFile });
            await ctx.deleteMessage();
        }
    } catch (e) {
        console.error("Download Error:", e);
        await ctx.editMessageText("❌ Download Failed.");
    } finally {
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
});

// --- SERVER SETUP ---
// This path '/' handles the "Access Denied" browser error
app.get('/', (req, res) => {
    res.status(200).send('✅ Bot is Alive and Running!');
});

// Webhook Setup
if (process.env.NODE_ENV === 'production') {
    app.use(bot.webhookCallback('/bot'));
    bot.telegram.setWebhook(`${URL}/bot`);
    // Listen on 0.0.0.0 to fix Render Access Denied
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
} else {
    bot.launch();
}
