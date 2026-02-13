const { Telegraf } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Import Version
const { version } = require('./package.json');

// Import Modules
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');

// Import New Controllers (These hold the new logic)
const { handleMessage } = require('./src/controllers/messageHandler');
const { handleCallback } = require('./src/controllers/callbackHandler');

// Init Logger
logger.init();

const bot = new Telegraf(config.BOT_TOKEN);
const app = express();

// Ensure Download Directory Exists
if (!fs.existsSync(config.DOWNLOAD_DIR)) {
    fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
}

// --- COMMANDS ---
bot.start((ctx) => ctx.reply(
    `👋 **Media Banai Bot v${version}**\n\nStable Mode.\nSend Reddit, Twitter, TikTok, or Instagram links.\n\nYou can add a custom caption by typing text after the link.`
));

// --- HANDLERS (Delegating to Controllers) ---

// 1. Text Messages -> messageHandler.js
bot.on('text', handleMessage);

// 2. Callback Queries (Buttons) -> callbackHandler.js
bot.on('callback_query', handleCallback);

// --- SERVER (Dashboard & Webhook) ---
app.get('/api/logs', (req, res) => res.json(logger.getLogs()));

app.get('/', (req, res) => {
    res.send(`
    <html>
    <head>
        <meta http-equiv="refresh" content="2">
        <title>Media Banai v${version}</title>
        <style>body{background:#0d1117;color:#c9d1d9;font-family:monospace;padding:20px} .err{color:#f85149} .inf{color:#3fb950}</style>
    </head>
    <body>
        <h1>🚀 Media Banai Bot v${version}</h1>
        <div id="logs">Loading...</div>
        <script>
            fetch('/api/logs').then(r=>r.json()).then(d=>{
                document.getElementById('logs').innerHTML = d.map(l => 
                    \`<div style="border-bottom:1px solid #30363d;padding:2px">
                        <span style="color:#8b949e">[\${l.time}]</span> 
                        <span class="\${l.type === 'ERROR' ? 'err' : 'inf'}">\${l.type}</span> 
                        \${l.message}
                    </div>\`
                ).join('');
            });
        </script>
    </body>
    </html>`);
});

if (process.env.NODE_ENV === 'production') {
    // Webhook Mode for Production (Render/Railway)
    app.use(bot.webhookCallback('/bot'));
    bot.telegram.setWebhook(`${config.APP_URL}/bot`);
    app.listen(config.PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${config.PORT}`));
} else {
    // Polling Mode for Local Development
    bot.launch();
    console.log("🚀 Bot started in Polling Mode");
}

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
