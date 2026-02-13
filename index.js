const { Telegraf } = require('telegraf');
const fs = require('fs');
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const db = require('./src/utils/db');

// Services & Handlers
const poller = require('./src/services/poller'); 
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
if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is missing in Environment Variables!");
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
    if (await handleEditCaption(ctx)) return;
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        return handleGroupMessage(ctx, () => handleMessage(ctx));
    }
    return handleMessage(ctx);
});

bot.on('callback_query', handleCallback);

// --- START SERVICES (Polling vs Webhook) ---
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
    // Railway Webhook Setup
    const webhookPath = `/bot${config.BOT_TOKEN}`;
    const webhookUrl = `${config.APP_URL}${webhookPath}`;
    
    // ৪২৯ এরর হ্যান্ডলিং লজিক
    bot.telegram.setWebhook(webhookUrl)
        .then(() => console.log(`🚀 Webhook Link Active: ${webhookUrl}`))
        .catch(err => {
            if (err.response && err.response.error_code === 429) {
                console.log("⚠️ Telegram Rate Limit (429). Bot is already using the existing webhook.");
            } else {
                console.error(`❌ Webhook Error: ${err.message}`);
            }
        });

    // Web Console এবং Webhook এক সাথে চালানোর জন্য
    setupServer(bot, webhookPath); 
} else {
    // Local Testing
    poller.init(bot);
    setupServer(bot); 
}

// --- SAFE SHUTDOWN ---
const stopBot = (signal) => {
    console.log(`Stopping via ${signal}...`);
    if (!isProduction) bot.stop(signal);
    else process.exit(0);
};

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));
