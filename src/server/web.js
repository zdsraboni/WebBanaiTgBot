const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 

const setupServer = (bot) => {
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/api/logs', (req, res) => res.json(logger.getLogs()));

    // AUTOMATION WEBHOOK
    app.all('/api/trigger', async (req, res) => {
        const query = req.query;
        const body = req.body;
        const secret = query.secret || body.secret;
        const url = query.url || body.url;

        if (String(secret) !== String(config.ADMIN_ID)) return res.status(403).send('❌ Access Denied');
        if (!url) return res.status(400).send('❌ No URL');

        res.status(200).send('✅ Processing...');

        try {
            const userId = config.ADMIN_ID; 
            console.log(`🤖 Auto-Download Triggered: ${url}`);

            // 1. Initial Status
            const msg = await bot.telegram.sendMessage(userId, `🔄 <b>Auto-Download Started...</b>`, { parse_mode: 'HTML' });

            // 2. ✅ FIXED MOCK CONTEXT
            // We ensure replyWithVideo works exactly like Telegraf's ctx.replyWithVideo
            const mockCtx = {
                from: { id: userId, first_name: 'Admin', is_bot: false },
                chat: { id: userId, type: 'private' },
                message: { text: url, message_id: 0, from: { id: userId } },
                
                // CORE FUNCTIONS
                reply: (text, extra) => bot.telegram.sendMessage(userId, text, extra),
                
                // MEDIA FUNCTIONS (Fixing the crash)
                replyWithVideo: (source, extra) => bot.telegram.sendVideo(userId, source.source || source, extra),
                replyWithAudio: (source, extra) => bot.telegram.sendAudio(userId, source.source || source, extra),
                replyWithPhoto: (source, extra) => bot.telegram.sendPhoto(userId, source.source || source, extra),
                replyWithDocument: (source, extra) => bot.telegram.sendDocument(userId, source.source || source, extra),

                // EDITING FUNCTIONS
                telegram: {
                    editMessageText: (chatId, msgId, inlineMsgId, text, extra) => 
                        bot.telegram.editMessageText(chatId, msgId, inlineMsgId, text, extra),
                    deleteMessage: (chatId, msgId) => bot.telegram.deleteMessage(chatId, msgId)
                },
                
                // CALLBACK HANDLING
                answerCbQuery: () => Promise.resolve(),
                editMessageCaption: (caption, extra) => bot.telegram.editMessageCaption(userId, undefined, undefined, caption, extra)
            };

            // 3. Pass to Logic
            await handlers.performDownload(mockCtx, url, false, 'best', msg.message_id, `🤖 <b>Auto-Captured</b>\nSource: ${url}`, null);

        } catch (e) {
            console.error("Webhook Execution Error:", e);
        }
    });

    // Hacker Terminal
    app.get('/', (req, res) => {
        res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Media Banai</title><style>body{background:#0d1117;color:#c9d1d9;font-family:monospace;padding:20px}h1{color:#58a6ff;border-bottom:1px solid #30363d;padding-bottom:10px}.log-entry{border-bottom:1px solid #161b22;padding:4px 0}.INFO{color:#3fb950}.ERROR{color:#f85149}</style></head><body><h1>🚀 Media Banai Bot</h1><div id="logs">Connecting...</div><script>setInterval(async()=>{try{const r=await fetch('/api/logs');const d=await r.json();document.getElementById('logs').innerHTML=d.map(l=>\`<div class="log-entry"><span class="\${l.type}">[\${l.time}] \${l.type}:</span> \${l.message}</div>\`).join('');}catch(e){}},2000);</script></body></html>`);
    });

    const keepAlive = () => { if (config.APP_URL) axios.get(`${config.APP_URL}/api/logs`).catch(()=>{}); };
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