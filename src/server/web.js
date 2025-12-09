const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 

const setupServer = (bot) => {
    const app = express();

    // Enable Body Parsing (For POST requests from IFTTT/Shortcuts)
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 1. Logs
    app.get('/api/logs', (req, res) => res.json(logger.getLogs()));

    // 2. PRODUCTION AUTOMATION WEBHOOK
    app.all('/api/trigger', async (req, res) => {
        const query = req.query;
        const body = req.body;
        
        // Get data from either URL (?secret=...) or Body (JSON)
        const secret = query.secret || body.secret;
        const url = query.url || body.url;

        // Security Check
        if (String(secret) !== String(config.ADMIN_ID)) {
            return res.status(403).send('❌ Access Denied');
        }

        if (!url) return res.status(400).send('❌ No URL provided');

        // ✅ Respond to IFTTT immediately (Prevents Timeout errors)
        res.status(200).send('✅ Processing started...');

        try {
            const userId = config.ADMIN_ID; 

            console.log(`🤖 Auto-Download Triggered for: ${url}`);

            // 1. Send a quick status update to Telegram
            // (Optional: You can remove this if you want it completely silent)
            await bot.telegram.sendMessage(userId, `🔄 <b>Auto-Download Started...</b>`, { parse_mode: 'HTML' });

            // 2. Create a "Ghost Context"
            // This tricks the bot into thinking YOU sent the message manually.
            const mockCtx = {
                // User Info (Pretend it's you)
                from: { id: userId, first_name: 'Admin', is_bot: false },
                chat: { id: userId, type: 'private' },
                
                // The Message (The Link from IFTTT)
                message: { 
                    text: url, 
                    message_id: 0, 
                    from: { id: userId }
                },

                // Map Bot Functions
                reply: (text, extra) => bot.telegram.sendMessage(userId, text, extra),
                telegram: bot.telegram,
                
                // Mock "Edit Message" (Since there's no real previous message to edit, we send new ones or ignore)
                // We map editMessageText to sendMessage for status updates, or just ignore to keep chat clean.
                // Let's map it to sendMessage so you see "Analyzing" -> "Downloading" updates.
                // Note: Real handleMessage expects a message_id to edit.
                // We will let handleMessage send the first "Searching" reply, then it will use that ID.
            };

            // 3. Pass to the Main Logic
            // This will run Regex, Clean the Link, Check Insta/TikTok/Twitter, and Download.
            await handlers.handleMessage(mockCtx);

        } catch (e) {
            console.error("Webhook Execution Error:", e);
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