const { Telegraf } = require('telegraf');
const fs = require('fs');
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const db = require('./src/utils/db');

// UPDATED: Import new handlers
const { handleMessage, handleCallback, handleAdmin, handleGroupMessage, handleStart, handleHelp } = require('./src/utils/handlers');
const { setupServer } = require('./src/server/web');

logger.init();
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

db.connect(); 

const bot = new Telegraf(config.BOT_TOKEN);

// --- PROFESSIONAL COMMANDS ---
bot.start(handleStart);
bot.help(handleHelp);

bot.command('stats', handleAdmin);
bot.command('broadcast', handleAdmin);

bot.on('text', async (ctx, next) => {
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        await handleGroupMessage(ctx, () => handleMessage(ctx));
    } else {
        handleMessage(ctx);
    }
});

bot.on('callback_query', handleCallback);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

setupServer(bot);