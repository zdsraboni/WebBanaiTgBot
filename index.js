const { Telegraf } = require('telegraf');
const fs = require('fs');

// Imports
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const db = require('./src/utils/db');

// Services
const poller = require('./src/services/poller'); // ✅ The New API Engine

// Handlers
const { 
    handleMessage, 
    handleCallback, 
    handleGroupMessage, 
    handleStart, 
    handleHelp, 
    handleConfig // ✅ The New Config Handler
} = require('./src/utils/handlers');

const { handleStats, handleBroadcast } = require('./src/utils/admin'); 
const { setupServer } = require('./src/server/web');

// 1. Initialize Logger & Folders
logger.init();
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

// 2. Connect Database
db.connect(); 

// 3. Initialize Bot
const bot = new Telegraf(config.BOT_TOKEN);

// --- COMMANDS ---
bot.start(handleStart);
bot.help(handleHelp);

// Admin Stats
bot.command('stats', handleStats);
bot.command('broadcast', handleBroadcast);

// API Configuration (TwitterAPI.io)
bot.command('setup_api', handleConfig);
bot.command('mode', handleConfig);

// --- MESSAGE LOGIC ---
bot.on('text', async (ctx, next) => {
    // 1. If Group: Check for Ghost Mentions first
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        await handleGroupMessage(ctx, () => handleMessage(ctx));
    } else {
        // 2. If Private: Go straight to Download Logic
        handleMessage(ctx);
    }
});

// --- CALLBACKS (Buttons) ---
bot.on('callback_query', handleCallback);

// --- START SERVICES ---
// Start the Twitter Polling Engine (Runs every 1 min)
poller.init(bot);

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Start Web Server (IFTTT Webhook + Hacker Terminal)
setupServer(bot);
