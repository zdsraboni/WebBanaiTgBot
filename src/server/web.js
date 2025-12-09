const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 

const setupServer = (bot) => {
    const app = express();

    // ✅ ENABLE PARSING (So we can read POST body data too)
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 1. Logs
    app.get('/api/logs', (req, res) => res.json(logger.getLogs()));

    // 2. SUPER DEBUG WEBHOOK (Accepts GET and POST)
    app.all('/api/trigger', async (req, res) => {
        const method = req.method; // GET or POST
        const query = req.query;   // Data in URL (?url=...)
        const body = req.body;     // Data in Body (JSON)

        console.log(`🔔 Webhook Hit via ${method}`);
        console.log("Query:", JSON.stringify(query));
        console.log("Body:", JSON.stringify(body));

        // Reply to IFTTT immediately
        res.status(200).send('✅ Debug Data Received');

        try {
            const userId = config.ADMIN_ID; 

            // BUILD THE REPORT
            let msg = `🕵️ <b>IFTTT Data Dump</b>\n`;
            msg += `-----------------------------\n`;
            msg += `<b>Method:</b> ${method}\n`;
            msg += `<b>Secret Received:</b> <code>${query.secret || body.secret || 'NONE'}</code>\n`;
            msg += `<b>My Secret:</b> <code>${config.ADMIN_ID}</code>\n\n`;

            // SHOW QUERY PARAMS (What's in the URL)
            if (Object.keys(query).length > 0) {
                msg += `<b>📥 URL Parameters:</b>\n<pre>${JSON.stringify(query, null, 2)}</pre>\n\n`;
            }

            // SHOW BODY DATA (If IFTTT sent JSON)
            if (Object.keys(body).length > 0) {
                msg += `<b>📦 Body/JSON Data:</b>\n<pre>${JSON.stringify(body, null, 2)}</pre>\n`;
            }

            // ANALYSIS
            const receivedUrl = query.url || body.url;
            if (!receivedUrl) {
                msg += `❌ <b>ERROR:</b> No 'url' found in data!`;
            } else {
                msg += `✅ <b>URL Found:</b> ${receivedUrl}`;
            }

            // Send to Telegram
            await bot.telegram.sendMessage(userId, msg, { parse_mode: 'HTML' });

        } catch (e) {
            console.error("Debug Error:", e);
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