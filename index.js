const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 1. Import Config
const config = require('./src/config/settings');

// 2. Initialize Logger FIRST
const logger = require('./src/utils/logger');
logger.init(); 

// 3. Import Services (THE FIX: Using correct modular files)
const downloader = require('./src/utils/downloader');
const redditService = require('./src/services/reddit');
const twitterService = require('./src/services/twitter');

const bot = new Telegraf(config.BOT_TOKEN);
const app = express();

// Ensure download directory exists
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

// --- UTILITIES ---
const resolveRedirect = async (url) => {
    if (!url.includes('/s/')) return url;
    try {
        const res = await axios.head(url, {
            maxRedirects: 0,
            validateStatus: s => s >= 300 && s < 400,
            headers: { 'User-Agent': config.UA_ANDROID }
        });
        return res.headers.location || url;
    } catch (e) { return url; }
};

// --- BOT HANDLERS ---

bot.start((ctx) => ctx.reply("👋 Welcome to Media Banai Bot!\nI am ready with Live Logs."));

bot.on('text', async (ctx) => {
    const match = ctx.message.text.match(config.URL_REGEX);
    if (!match) return;

    // Log the request to show up in your Live Tail
    console.log(`📩 New Request: ${match[0]}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const inputUrl = match[0];
        const fullUrl = await resolveRedirect(inputUrl);
        let media = null;

        // Route to the correct service
        if (fullUrl.includes('x.com') || fullUrl.includes('twitter.com')) {
            media = await twitterService.extract(fullUrl);
        } else {
            media = await redditService.extract(fullUrl);
        }

        if (!media) throw new Error("Media not found");

        // --- RENDER INTERFACE ---
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
            if (media.formats && media.formats.length > 0) {
                const formats = media.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height);
                const seen = new Set();
                formats.slice(0, 5).forEach(f => {
                    if(!seen.has(f.height)) {
                        seen.add(f.height);
                        buttons.push([Markup.button.callback(`📹 ${f.height}p`, `vid|${f.format_id}`)]);
                    }
                });
            } else {
                buttons.push([Markup.button.callback("📹 Download Video", `vid|best`)]);
            }
            buttons.push([Markup.button.callback("🎵 Audio Only", "aud|best")]);
        }

        const safeUrl = media.url || media.source; 
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            `${text}\nSource: [Link](${safeUrl})`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

    } catch (e) {
        console.error(`Processing Error: ${e.message}`);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
});

// --- CALLBACKS ---

bot.on('callback_query', async (ctx) => {
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
        await ctx.answerCbQuery("🚀 Downloading...");
        await ctx.editMessageText(`⏳ *Downloading...*`, { parse_mode: 'Markdown' });
        
        const timestamp = Date.now();
        const basePath = path.join(config.DOWNLOAD_DIR, `${timestamp}`);
        const finalFile = `${basePath}.${action === 'aud' ? 'mp3' : 'mp4'}`;

        try {
            console.log(`⬇️ Starting Download: ${url}`);
            await downloader.download(url, action === 'aud', id, basePath);

            const stats = fs.statSync(finalFile);
            if (stats.size > 49.5 * 1024 * 1024) {
                await ctx.editMessageText("⚠️ File > 50MB (Telegram Limit).");
            } else {
                await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
                action === 'aud' 
                    ? await ctx.replyWithAudio({ source: finalFile })
                    : await ctx.replyWithVideo({ source: finalFile });
                await ctx.deleteMessage();
                console.log(`✅ Upload Success: ${url}`);
            }
        } catch (e) {
            console.error(`Download Error: ${e.message}`);
            await ctx.editMessageText("❌ Error during download.");
        } finally {
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
        }
    }
});

// --- LIVE TAIL SERVER ---

// 1. API Endpoint for Logs
app.get('/api/logs', (req, res) => {
    res.json(logger.getLogs());
});

// 2. The "Hacker Terminal" Interface
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Media Banai - Live Console</title>
        <style>
            body { background-color: #0d1117; color: #c9d1d9; font-family: 'Consolas', 'Courier New', monospace; padding: 20px; font-size: 13px; margin: 0; }
            h1 { color: #58a6ff; font-size: 18px; border-bottom: 1px solid #30363d; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
            .status { font-size: 12px; background: #238636; color: white; padding: 2px 8px; border-radius: 12px; }
            #logs { white-space: pre-wrap; word-wrap: break-word; height: 85vh; overflow-y: auto; padding-bottom: 50px; }
            .log-entry { margin-bottom: 4px; display: flex; line-height: 1.5; border-bottom: 1px solid #161b22; }
            .timestamp { color: #8b949e; min-width: 90px; user-select: none; }
            .type-INFO { color: #3fb950; font-weight: bold; min-width: 50px; }
            .type-ERROR { color: #f85149; font-weight: bold; min-width: 50px; }
            .msg { color: #e6edf3; }
            .autoscroll { position: fixed; bottom: 20px; right: 20px; background: #1f6feb; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
        </style>
    </head>
    <body>
        <h1>
            <span>🚀 Media Banai Bot</span>
            <span class="status">● Online</span>
        </h1>
        <div id="logs">Connecting to log stream...</div>
        <button class="autoscroll" onclick="toggleScroll()" id="scrollBtn">Auto-Scroll: ON</button>

        <script>
            let autoScroll = true;
            const logContainer = document.getElementById('logs');
            const btn = document.getElementById('scrollBtn');

            function toggleScroll() {
                autoScroll = !autoScroll;
                btn.style.background = autoScroll ? '#1f6feb' : '#30363d';
                btn.innerText = 'Auto-Scroll: ' + (autoScroll ? 'ON' : 'OFF');
            }

            async function fetchLogs() {
                try {
                    const res = await fetch('/api/logs');
                    const data = await res.json();
                    
                    logContainer.innerHTML = data.map(log => 
                        \`<div class="log-entry">
                            <span class="timestamp">[\${log.time}]</span>
                            <span class="type-\${log.type}">\${log.type}</span>
                            <span class="msg">\${log.message}</span>
                        </div>\`
                    ).join('');

                    if (autoScroll) window.scrollTo(0, document.body.scrollHeight);
                } catch (e) { console.error("Log fetch failed", e); }
            }

            // Refresh logs every 2 seconds
            setInterval(fetchLogs, 2000);
            fetchLogs();
        </script>
    </body>
    </html>
    `);
});

// Launch Server
if (process.env.NODE_ENV === 'production') {
    app.use(bot.webhookCallback('/bot'));
    bot.telegram.setWebhook(`${config.APP_URL}/bot`);
    app.listen(config.PORT, '0.0.0.0', () => console.log(`🚀 Server listening on port ${config.PORT}`));
} else {
    bot.launch();
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
