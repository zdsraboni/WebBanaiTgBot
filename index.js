const { Telegraf } = require('telegraf');
const fs = require('fs');
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const db = require('./src/utils/db');

// Services & Handlers
const poller = require('./src/services/poller'); 
const handlers = require('./src/utils/handlers'); // Object হিসেবে ইমপোর্ট করা নিরাপদ
const { handleStats, handleBroadcast } = require('./src/utils/admin'); 
const { setupServer } = require('./src/server/web');

// ১. সিস্টেম ইনিশিয়ালিস্ট
logger.init();
if (!fs.existsSync(config.DOWNLOAD_DIR)) {
    fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
}
db.connect(); 

// ২. বট ইনিশিয়ালিস্ট
if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is missing in Railway Variables!");
const bot = new Telegraf(config.BOT_TOKEN);

/**
 * ৩. কমান্ড হ্যান্ডলার (Fixes "Handler is undefined" error)
 * ডিস্ট্রাকচারিং এর বদলে সরাসরি অবজেক্ট রেফারেন্স ব্যবহার করা হয়েছে যাতে এরর না হয়
 */
if (handlers.handleStart) bot.start(handlers.handleStart);
if (handlers.handleHelp) bot.help(handlers.help || handlers.handleHelp);

bot.command('stats', handleStats);
bot.command('broadcast', handleBroadcast);
bot.command('setup_api', handlers.handleConfig);
bot.command('mode', handlers.handleConfig);
bot.command('set_destination', handlers.handleConfig);

// ৪. মেসেজ লজিক
bot.on('text', async (ctx, next) => {
    // ক্যাপশন এডিটর চেক
    if (handlers.handleEditCaption && await handlers.handleEditCaption(ctx)) return;

    // গ্রুপ চ্যাট এবং নিকনেম লজিক
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        if (handlers.handleGroupMessage) {
            return handlers.handleGroupMessage(ctx, () => handlers.handleMessage(ctx));
        }
    }
    
    // প্রাইভেট চ্যাট ডাউনলোড লজিক
    if (handlers.handleMessage) return handlers.handleMessage(ctx);
});

// ৫. কলব্যাক হ্যান্ডলার
bot.on('callback_query', handlers.handleCallback);

// --- ৬. সার্ভিস স্টার্ট (Polling vs Webhook) ---
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
    // Railway Webhook Setup
    const webhookPath = `/bot${config.BOT_TOKEN}`;
    const webhookUrl = `${config.APP_URL}${webhookPath}`;
    
    bot.telegram.setWebhook(webhookUrl)
        .then(() => console.log(`🚀 Webhook Active: ${webhookUrl}`))
        .catch(err => {
            if (err.response && err.response.error_code === 429) {
                console.log("⚠️ Telegram 429: Rate limit hit, using existing webhook.");
            } else {
                console.error(`❌ Webhook Error: ${err.message}`);
            }
        });

    // পোর্ট সংঘর্ষ এড়াতে setupServer এর ভেতরে Webhook প্রসেস হবে
    setupServer(bot, webhookPath); 
} else {
    // Local Polling Mode
    poller.init(bot);
    setupServer(bot); 
}

// --- ৭. সেফ শাটডাউন (Fixes "Bot is not running" error)
const stopBot = (signal) => {
    console.log(`Stopping system via ${signal}...`);
    if (!isProduction && bot.polling) {
        bot.stop(signal);
    } else {
        process.exit(0);
    }
};

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));
