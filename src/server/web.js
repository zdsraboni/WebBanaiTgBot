const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 

const setupServer = (bot) => {
    const app = express();

    // Enable Body Parsing (For POST requests)
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 1. API Endpoint for Logs (Used by the Terminal)
    app.get('/api/logs', (req, res) => res.json(logger.getLogs()));

    // 2. IFTTT / AUTOMATION WEBHOOK
    app.all('/api/trigger', async (req, res) => {
        const query = req.query;
        const body = req.body;
        
        const secret = query.secret || body.secret;
        const url = query.url || body.url;

        // Security Check
        if (String(secret) !== String(config.ADMIN_ID)) {
            return res.status(403).send('❌ Access Denied');
        }

        if (!url) return res.status(400).send('❌ No URL provided');

        // ✅ Respond OK immediately (So IFTTT doesn't timeout)
        res.status(200).send('✅ Link Received. Check Telegram.');

        try {
            const userId = config.ADMIN_ID; 
            console.log(`🤖 Auto-Link Received: ${url}`);

            // Mock Context: Pretend you sent the message
            const mockCtx = {
                from: { id: userId, first_name: 'Admin', is_bot: false },
                chat: { id: userId, type: 'private' },
                message: { text: url, message_id: 0, from: { id: userId } },
                
                // Map Bot Functions
                reply: (text, extra) => bot.telegram.sendMessage(userId, text, extra),
                telegram: bot.telegram,
                answerCbQuery: () => Promise.resolve(),
                replyWithVideo: (v, e) => bot.telegram.sendVideo(userId, v, e),
                replyWithAudio: (a, e) => bot.telegram.sendAudio(userId, a, e),
                replyWithPhoto: (p, e) => bot.telegram.sendPhoto(userId, p, e),
                replyWithDocument: (d, e) => bot.telegram.sendDocument(userId, d, e),
            };

            // ✅ Pass to Main Handler -> It will show BUTTONS (Not auto-download)
            await handlers.handleMessage(mockCtx);

        } catch (e) {
            console.error("Webhook Error:", e);
        }
    });

    // 3. THE HACKER TERMINAL (RESTORED)
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
                .log-entry { margin-bottom: 4px; display: flex; line-height: 1.5; border-bottom: 1px solid #161b22; animation: fadeIn 0.3s ease-in; }
                .timestamp { color: #8b949e; min-width: 90px; user-select: none; }
                .type-INFO { color: #3fb950; font-weight: bold; min-width: 50px; }
                .type-ERROR { color: #f85149; font-weight: bold; min-width: 50px; }
                .msg { color: #e6edf3; }
                .autoscroll { position: fixed; bottom: 20px; right: 20px; background: #1f6feb; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.5); opacity: 0.8; }
                .autoscroll:hover { opacity: 1; }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            </style>
        </head>
        <body>
            <h1>
                <span>🚀 Media Banai Bot</span>
                <span class="status">● Online</span>
            </h1>
            <div id="logs">Connecting to log stream...</div>
            <button class="autoscroll" onclick="toggleScroll()" id="scrollBtn">Live Updates: ON</button>
            <script>
                let isLive = true;
                let displayedLogsCount = 0;
                const logContainer = document.getElementById('logs');
                const btn = document.getElementById('scrollBtn');

                function toggleScroll() {
                    isLive = !isLive;
                    if (isLive) {
                        btn.innerText = 'Live Updates: ON';
                        btn.style.background = '#1f6feb';
                        fetchLogs();
                    } else {
                        btn.innerText = 'Live Updates: PAUSED';
                        btn.style.background = '#30363d';
                    }
                }

                async function fetchLogs() {
                    if (!isLive) return;
                    try {
                        const res = await fetch('/api/logs');
                        const allLogs = await res.json();

                        if (allLogs.length < displayedLogsCount) {
                            logContainer.innerHTML = '';
                            displayedLogsCount = 0;
                        }

                        const newLogs = allLogs.slice(displayedLogsCount);

                        if (newLogs.length > 0) {
                            newLogs.forEach(log => {
                                const div = document.createElement('div');
                                div.className = 'log-entry';
                                div.innerHTML = \`
                                    <span class="timestamp">[\${log.time}]</span>
                                    <span class="type-\${log.type}">\${log.type}</span>
                                    <span class="msg">\${log.message}</span>
                                \`;
                                logContainer.appendChild(div);
                            });
                            displayedLogsCount = allLogs.length;
                            window.scrollTo(0, document.body.scrollHeight);
                        }
                    } catch (e) { console.error("Log fetch failed", e); }
                }

                setInterval(fetchLogs, 1500);
                fetchLogs();
            </script>
        </body>
        </html>
        `);
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
