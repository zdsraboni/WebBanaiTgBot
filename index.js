const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Import Modules
const config = require('./src/config/settings');
const logger = require('./src/utils/logger'); // Import Logger
const extractor = require('./src/services/extractors');
const downloader = require('./src/utils/downloader');

// Initialize Logger FIRST (So we catch boot logs)
logger.init();

// Init Bot & App
const bot = new Telegraf(config.BOT_TOKEN);
const app = express();

if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

// --- BOT LOGIC ---

bot.start((ctx) => ctx.reply("👋 Media Banai Bot Ready!\nSend Reddit or Twitter links."));

bot.on('text', async (ctx) => {
    const match = ctx.message.text.match(config.URL_REGEX);
    if (!match) return;

    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        console.log(`📩 New Request: ${match[0]}`);
        const media = await extractor.extract(match[0]);

        if (!media) throw new Error("Media not found");

        const buttons = [];
        let text = `✅ *${(media.title).substring(0, 50)}...*`;

        if (media.type === 'gallery') {
            text += `\n📚 **Gallery:** ${media.items.length} items`;
            buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        } 
        else if (media.type === 'image') {
            text += `\n🖼 **Image**`;
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
        const media = await extractor.extract(url);
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
            const isAudio = action === 'aud';
            await downloader.download(url, isAudio, id, basePath);

            const stats = fs.statSync(finalFile);
            if (stats.size > 49.5 * 1024 * 1024) {
                await ctx.editMessageText("⚠️ File > 50MB (Telegram Limit).");
            } else {
                await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
                isAudio 
                    ? await ctx.replyWithAudio({ source: finalFile })
                    : await ctx.replyWithVideo({ source: finalFile });
                await ctx.deleteMessage();
                console.log(`✅ Upload Complete: ${url}`);
            }
        } catch (e) {
            console.error(`Download Error: ${e.message}`);
            await ctx.editMessageText("❌ Error during download.");
        } finally {
            if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
        }
    }
});

// --- WEB SERVER (LIVE TAIL UI) ---

// 1. API to fetch logs
app.get('/api/logs', (req, res) => {
    res.json(logger.getLogs());
});

// 2. HTML Dashboard
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Media Banai - Live Tail</title>
        <style>
            body { background-color: #0d1117; color: #c9d1d9; font-family: 'Consolas', 'Courier New', monospace; padding: 20px; font-size: 14px; }
            h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
            #logs { white-space: pre-wrap; word-wrap: break-word; }
            .log-entry { margin-bottom: 4px; display: flex; }
            .timestamp { color: #8b949e; min-width: 100px; }
            .INFO { color: #3fb950; }
            .ERROR { color: #f85149; font-weight: bold; }
            .autoscroll { position: fixed; top: 20px; right: 20px; background: #21262d; border: 1px solid #30363d; color: white; padding: 5px 10px; cursor: pointer; border-radius: 6px; }
        </style>
    </head>
    <body>
        <h1>🚀 Media Banai Bot - Live Logs</h1>
        <button class="autoscroll" onclick="toggleScroll()">Auto-Scroll: ON</button>
        <div id="logs">Loading...</div>

        <script>
            let autoScroll = true;
            function toggleScroll() {
                autoScroll = !autoScroll;
                document.querySelector('.autoscroll').innerText = 'Auto-Scroll: ' + (autoScroll ? 'ON' : 'OFF');
            }

            async function fetchLogs() {
                try {
                    const res = await fetch('/api/logs');
                    const data = await res.json();
                    const container = document.getElementById('logs');
                    
                    container.innerHTML = data.map(log => 
                        \`<div class="log-entry">
                            <span class="timestamp">[\${log.time}]</span>
                            <span class="\${log.type}">\${log.type}:</span>&nbsp;
                            <span>\${log.message}</span>
                        </div>\`
                    ).join('');

                    if (autoScroll) window.scrollTo(0, document.body.scrollHeight);
                } catch (e) { console.error(e); }
            }

            setInterval(fetchLogs, 2000); // Refresh every 2 seconds
            fetchLogs();
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Launch
if (process.env.NODE_ENV === 'production') {
    app.use(bot.webhookCallback('/bot'));
    bot.telegram.setWebhook(`${config.APP_URL}/bot`);
    app.listen(config.PORT, '0.0.0.0', () => console.log(`🚀 Server on ${config.PORT}`));
} else {
    bot.launch();
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
