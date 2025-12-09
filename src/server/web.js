const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 

const setupServer = (bot) => {
    const app = express();

    // 1. Logs
    app.get('/api/logs', (req, res) => res.json(logger.getLogs()));

    // 2. DEBUG WEBHOOK (See what IFTTT sends)
    app.get('/api/trigger', async (req, res) => {
        const queryData = req.query; // This holds ?secret=...&url=...
        const { secret, url } = queryData;

        // A. Respond to IFTTT immediately to prevent Timeout
        res.status(200).send('✅ Debug Data Received');

        try {
            const userId = config.ADMIN_ID; 

            // B. LOG TO CONSOLE (Check Render Logs)
            console.log("🔔 Webhook Hit! Data:", JSON.stringify(queryData));

            // C. SEND DEBUG REPORT TO TELEGRAM
            // This tells you exactly what arrived
            let report = `🕵️ <b>Webhook Debug Report</b>\n`;
            report += `<b>Status:</b> Connection Successful\n`;
            report += `<b>Secret Received:</b> <code>${secret || 'None'}</code>\n`;
            report += `<b>Correct Secret:</b> <code>${config.ADMIN_ID}</code>\n`;
            report += `<b>URL Received:</b> ${url ? url : '❌ NONE'}\n\n`;
            
            // Check if secret matches
            if (String(secret) !== String(config.ADMIN_ID)) {
                report += `⚠️ <b>PASSWORD MISMATCH!</b> Check IFTTT settings.`;
                await bot.telegram.sendMessage(userId, report, { parse_mode: 'HTML' });
                return; // Stop here if password wrong
            }

            // D. IF URL IS MISSING
            if (!url) {
                report += `⚠️ <b>NO URL FOUND!</b> Check if IFTTT Ingredient is set.`;
                await bot.telegram.sendMessage(userId, report, { parse_mode: 'HTML' });
                return;
            }

            // E. IF EVERYTHING IS GOOD -> RUN BOT
            await bot.telegram.sendMessage(userId, `${report}✅ <b>Starting Download...</b>`, { parse_mode: 'HTML' });

            // Create Fake Context
            const mockCtx = {
                from: { id: userId, first_name: 'Admin', is_bot: false },
                chat: { id: userId, type: 'private' },
                message: { text: url, message_id: 0, from: { id: userId } },
                reply: (text, extra) => bot.telegram.sendMessage(userId, text, extra),
                telegram: bot.telegram,
                answerCbQuery: () => Promise.resolve(),
                replyWithPhoto: (p, e) => bot.telegram.sendPhoto(userId, p, e),
                replyWithVideo: (v, e) => bot.telegram.sendVideo(userId, v, e),
                replyWithAudio: (a, e) => bot.telegram.sendAudio(userId, a, e),
            };

            await handlers.handleMessage(mockCtx);

        } catch (e) {
            console.error("Webhook Error:", e);
        }
    });

    // 3. Hacker Terminal
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
