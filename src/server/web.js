const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 

const setupServer = (bot) => {
    const app = express();

    // 1. Logs
    app.get('/api/logs', (req, res) => res.json(logger.getLogs()));

    // 2. IFTTT / AUTOMATION WEBHOOK
    app.get('/api/trigger', async (req, res) => {
        const { secret, url } = req.query;

        // Security Check
        if (secret !== String(config.ADMIN_ID)) {
            return res.status(403).send('❌ Access Denied');
        }
        if (!url) return res.status(400).send('❌ No URL provided');

        // ✅ CRITICAL FIX FOR TIMEOUT: 
        // We tell IFTTT "Success" immediately (Fire and Forget).
        // This prevents IFTTT from showing "Error/Timeout" while the video downloads.
        res.status(200).send('✅ Signal Received. Processing in background...');

        try {
            const userId = config.ADMIN_ID; 

            // 3. THE "GHOST USER" SIMULATION
            // We create a fake "Context" that looks exactly like a real Telegram message.
            const mockCtx = {
                // User Info
                from: { id: userId, first_name: 'Admin', is_bot: false },
                chat: { id: userId, type: 'private' },
                
                // The Message Content (From IFTTT)
                message: { 
                    text: url, 
                    message_id: 0, // Virtual ID
                    from: { id: userId }
                },

                // Functions the bot needs to reply
                reply: (text, extra) => bot.telegram.sendMessage(userId, text, extra),
                telegram: bot.telegram,
                
                // Allow the bot to "Answer" callbacks if needed (mocked)
                answerCbQuery: () => Promise.resolve(),
                replyWithPhoto: (photo, extra) => bot.telegram.sendPhoto(userId, photo, extra),
                replyWithVideo: (video, extra) => bot.telegram.sendVideo(userId, video, extra),
                replyWithAudio: (audio, extra) => bot.telegram.sendAudio(userId, audio, extra),
                replyWithDocument: (doc, extra) => bot.telegram.sendDocument(userId, doc, extra)
            };

            // ✅ PASS TO MAIN HANDLER
            // The bot will treat this exactly like you typed the link in the chat.
            // It will run regex checks, find the media, and download it.
            console.log(`🤖 Webhook Triggered for: ${url}`);
            await handlers.handleMessage(mockCtx);

        } catch (e) {
            console.error("Webhook Error:", e);
        }
    });

    // 3. Hacker Terminal
    app.get('/', (req, res) => {
        res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Media Banai</title><style>body{background:#0d1117;color:#c9d1d9;font-family:monospace;padding:20px}h1{color:#58a6ff;border-bottom:1px solid #30363d;padding-bottom:10px}.log-entry{border-bottom:1px solid #161b22;padding:4px 0}.INFO{color:#3fb950}.ERROR{color:#f85149}</style></head><body><h1>🚀 Media Banai Bot</h1><div id="logs">Connecting...</div><script>setInterval(async()=>{try{const r=await fetch('/api/logs');const d=await r.json();document.getElementById('logs').innerHTML=d.map(l=>\`<div class="log-entry"><span class="\${l.type}">[\${l.time}] \${l.type}:</span> \${l.message}</div>\`).join('');}catch(e){}},2000);</script></body></html>`);
    });

    // Anti-Sleep
    const keepAlive = () => {
        if (config.APP_URL) axios.get(`${config.APP_URL}/api/logs`).then(()=>console.log("⏰ Ping")).catch(()=>{});
    };
    setInterval(keepAlive, 600000);

    if (process.env.NODE_ENV === 'production') {
        app.use(bot.webhookCallback('/bot'));
        bot.telegram.setWebhook(`${config.APP_URL}/bot`);
        app.listen(config.PORT, '0.0.0.0', () => console.log(`🚀 Server listening on port ${config.PORT}`));
        setTimeout(keepAlive, 60000); 
    } else {
        bot.launch();
        console.log("🚀 Polling mode started");
    }
};

module.exports = { setupServer };
