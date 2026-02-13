const { Telegraf } = require('telegraf');
const fs = require('fs');
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const db = require('./src/utils/db');

// Services
const poller = require('./src/services/poller'); 

// Handlers
const { 
    handleMessage, 
    handleCallback, 
    handleGroupMessage, 
    handleStart, 
    handleHelp, 
    handleConfig,
    handleEditCaption 
} = require('./src/utils/handlers');

const { handleStats, handleBroadcast } = require('./src/utils/admin'); 
const { setupServer } = require('./src/server/web');

// 1. Initialize System
logger.init();
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
db.connect(); 

// 2. Initialize Bot
const bot = new Telegraf(config.BOT_TOKEN);

// --- COMMANDS ---
bot.start(handleStart);
bot.help(handleHelp);
bot.command('stats', handleStats);
bot.command('broadcast', handleBroadcast);
bot.command('setup_api', handleConfig);
bot.command('mode', handleConfig);
bot.command('set_destination', handleConfig);

// --- MESSAGE LOGIC ---
bot.on('text', async (ctx, next) => {
    // Check Caption Editor first
    if (await handleEditCaption(ctx)) return;

    // Group Chat logic
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        return handleGroupMessage(ctx, () => handleMessage(ctx));
    }
    
    // Private Chat logic
    return handleMessage(ctx);
});

// --- CALLBACKS ---
bot.on('callback_query', handleCallback);

// --- START SERVICES (Polling vs Webhook) ---
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
    // Railway-তে Webhook চালু করার সঠিক নিয়ম
    const webhookPath = '/bot' + config.BOT_TOKEN;
    const webhookUrl = `${config.APP_URL}${webhookPath}`;
    
    bot.telegram.setWebhook(webhookUrl)
        .then(() => {
            console.log(`🚀 Webhook Engine Started: ${webhookUrl}`);
        })
        .catch((err) => {
            console.error(`❌ Webhook Error: ${err.message}`);
        });
        
    // Express Server-এর সাথে Webhook সংযুক্ত করা
    bot.startWebhook(webhookPath, null, config.PORT);
} else {
    // লোকাল এনভায়রনমেন্টে পোলিং চলবে
    poller.init(bot);
}

// --- SAFE SHUTDOWN LOGIC (Fixes "Bot is not running!" error) ---
const stopBot = (signal) => {
    console.log(`Stopping bot via ${signal}...`);
    // পোলিং চললে শুধু তখনই স্টপ করবে, নাহলে প্রসেস এক্সিট করবে
    if (!isProduction) {
        bot.stop(signal);
    } else {
        process.exit(0);
    }
};

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));

// --- WEB CONSOLE SETUP ---
setupServer(bot);
