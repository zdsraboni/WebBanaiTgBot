const { Telegraf } = require('telegraf');
const fs = require('fs');

// Imports
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
// UPDATED PATH BELOW:
const { handleMessage, handleCallback } = require('./src/utils/handlers');
const { setupServer } = require('./src/server/web');

// 1. Initialize Logger & Folders
logger.init();
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

// 2. Initialize Bot
const bot = new Telegraf(config.BOT_TOKEN);

// 3. Register Handlers
bot.start((ctx) => ctx.reply("👋 Welcome to Media Banai Bot!\nI am ready with Live Logs."));
bot.on('text', handleMessage);
bot.on('callback_query', handleCallback);

// 4. Start Server & Bot
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

setupServer(bot);