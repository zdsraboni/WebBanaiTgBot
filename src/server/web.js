const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 
const db = require('../utils/db');

const setupServer = (bot, webhookPath) => {
    const app = express();

    // Enable Body Parsing
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // ১. ওয়েববুক কলব্যাক হ্যান্ডলার (রেলওয়ের জন্য)
    if (process.env.NODE_ENV === 'production' && webhookPath) {
        app.use(bot.webhookCallback(webhookPath));
        console.log("📡 Webhook Callback attached to: " + webhookPath);
    }

    // ২. API Endpoint for Logs
    app.get('/api/logs', (req, res) => {
        res.json(logger.getLogs());
    });

    // ৩. AUTOMATION WEBHOOK (External Trigger)
    app.all('/api/trigger', async (req, res) => {
        const query = req.query;
        const body = req.body;
        
        const secret = query.secret || body.secret;
        const url = query.url || body.url;

        if (String(secret) !== String(config.ADMIN_ID)) {
            return res.status(403).send('❌ Access Denied');
        }

        if (!url) return res.status(400).send('❌ No URL provided');

        res.status(200).send('✅ Link Received. Processing...');

        try {
            const userConfig = await db.getAdminConfig(config.ADMIN_ID);
            const targetId = userConfig?.twitterConfig?.webhookTarget || config.ADMIN_ID;

            const mockCtx = {
                from: { id: config.ADMIN_ID, first_name: 'Admin' },
                chat: { id: targetId },
                message: { text: url, message_id: 0, from: { id: config.ADMIN_ID } },
                reply: (text, extra) => bot.telegram.sendMessage(targetId, text, extra),
                telegram: bot.telegram,
                answerCbQuery: () => Promise.resolve(),
                replyWithVideo: (v, e) => bot.telegram.sendVideo(targetId, v, e),
                replyWithAudio: (a, e) => bot.telegram.sendAudio(targetId, a, e),
                replyWithPhoto: (p, e) => bot.telegram.sendPhoto(targetId, p, e),
                replyWithDocument: (d, e) => bot.telegram.sendDocument(targetId, d, e),
                editMessageMedia: (media, extra) => bot.telegram.sendVideo(targetId, media.media.source, { caption: media.caption, parse_mode: 'HTML' }) 
            };

            await handlers.handleMessage(mockCtx);
        } catch (e) { console.error("Trigger Error:", e); }
    });

    // ৪. THE HACKER TERMINAL (UI)
    app.get('/', (req, res) => {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Media Banai - Live Console</title>
            <style>
                body { background-color: #0d1117; color: #c9d1d9; font-family: 'Consolas', monospace; padding: 20px; font-size: 13px; margin: 0; }
                h1 { color: #58a6ff; font-size: 18px; border-bottom: 1px solid #30363d; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
                .status { font-size: 12px; background: #238636; color: white; padding: 2px 8px; border-radius: 12px; }
                #logs { white-space: pre-wrap; word-wrap: break-word; height: 85vh; overflow-y: auto; padding-bottom: 50px; }
                .log-entry { margin-bottom: 4px; display: flex; line-height: 1.5; border-bottom: 1px solid #161b22; }
                .timestamp { color: #8b949e; min-width: 90px; }
                .type-INFO { color: #3fb950; font-weight: bold; min-width: 50px; }
                .type-ERROR { color: #f85149; font-weight: bold; min-width: 50px; }
            </style>
        </head>
        <body>
            <h1><span>🚀 Media Banai Live</span> <span class="status">● Online</span></h1>
            <div id="logs">Connecting...</div>
            <script>
                async function fetchLogs() {
                    try {
                        const res = await fetch('/api/logs');
                        const data = await res.json();
                        const logBox = document.getElementById('logs');
                        logBox.innerHTML = data.map(log => \`
                            <div class="log-entry">
                                <span class="timestamp">[\${log.time}]</span>
                                <span class="type-\${log.type}">\${log.type}</span>
                                <span class="msg">\${log.message}</span>
                            </div>\`).join('');
                        window.scrollTo(0, document.body.scrollHeight);
                    } catch (e) {}
                }
                setInterval(fetchLogs, 2000);
                fetchLogs();
            </script>
        </body>
        </html>`);
    });

    // ৫. সার্ভার লিসেনিং (Conflict Fix)
    app.listen(config.PORT, '0.0.0.0', () => {
        console.log("🚀 Server listening on port " + config.PORT);
    });

    // ৬. Keep-alive লজিক (Fixed Syntax)
    const keepAlive = () => { 
        if (config.APP_URL) {
            axios.get(config.APP_URL + "/api/logs").catch(() => {}); 
        }
    };
    setInterval(keepAlive, 600000);
};

module.exports = { setupServer };
