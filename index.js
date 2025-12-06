const { Telegraf } = require('telegraf');
const fs = require('fs');

// Imports
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const db = require('./src/utils/db'); // Import DB
// Ensure you have the updated handlers from the previous step!
const { handleMessage, handleCallback, handleAdmin } = require('./src/utils/handlers');
const { setupServer } = require('./src/server/web');

// 1. Initialize Logger, Folders & Database
logger.init();
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

// CONNECT TO DATABASE
db.connect(); 

// 2. Initialize Bot
const bot = new Telegraf(config.BOT_TOKEN);

// 3. Register Handlers
bot.start((ctx) => {
    if (ctx.from) db.addUser(ctx.from.id); // Save user to Mongo
    ctx.reply("👋 Welcome to Media Banai Bot!\nI am ready with Live Logs.");
});

// Admin Commands
bot.command('stats', handleAdmin);
bot.command('broadcast', handleAdmin);

// Standard Handlers
bot.on('text', handleMessage);
bot.on('callback_query', handleCallback);

// 4. Start Server & Bot
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

setupServer(bot);