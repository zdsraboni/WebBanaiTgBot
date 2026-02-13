const { Telegraf } = require('telegraf');
const fs = require('fs');
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const db = require('./src/utils/db');

// Services
const poller = require('./src/services/poller'); 

// Handlers
const { 
    handleMessage, handleCallback, handleGroupMessage, 
    handleStart, handleHelp, handleConfig, handleEditCaption 
} = require('./src/utils/handlers');

const { handleStats, handleBroadcast } = require('./src/utils/admin'); 
const { setupServer } = require('./src/server/web');

// 1. Initialize System
logger.init();
if (!fs.existsSync(config.DOWNLOAD_DIR)) {
    fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
}
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
    // Check if user is editing a caption
    if (await handleEditCaption(ctx)) return;

    // Handle Group Chats
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        return handleGroupMessage(ctx, () => handleMessage(ctx));
    }
    
    // Handle Private Chat Downloads
    return handleMessage(ctx);
});

// Callback handle logic
bot.on('callback_query', handleCallback);

// --- START SERVICES (Polling vs Webhook) ---
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
    // Railway Webhook Setup
    const webhookPath = `/bot${config.BOT_TOKEN}`;
    const webhookUrl = `${config.APP_URL}${webhookPath}`;
    
    bot.telegram.setWebhook(webhookUrl)
        .then(() => console.log(`🚀 Webhook Successfully Set: ${webhookUrl}`))
        .catch(err => console.error(`❌ Webhook Error: ${err.message}`));

    /**
     * পোর্ট সংঘর্ষ এড়াতে:
     * bot.startWebhook() এখানে কল করা যাবে না। 
     * আমরা setupServer() এর Express এপ্লিকেশন ব্যবহার করে একই পোর্টে 
     * Webhook এবং Web Console চালাবো।
     */
    setupServer(bot, webhookPath); 
} else {
    // Local Testing Mode
    poller.init(bot);
    setupServer(bot); // লোকাল ওয়েব কনসোল
}

// --- SAFE SHUTDOWN (Fixes "Bot is not running" error) ---
const stopBot = (signal) => {
    console.log(`Stopping system via ${signal}...`);
    if (!isProduction) {
        // Polling thakle bot stop korbe
        bot.stop(signal);
    } else {
        // Webhook mode-e bot stop korar proyojon nei, sudhu process exit korlei hobe
        process.exit(0);
    }
};

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));
