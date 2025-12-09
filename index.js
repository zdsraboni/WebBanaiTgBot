// ... imports ...
const poller = require('./src/services/poller'); // Import Poller

// ... handlers imports ...
const { handleMessage, handleCallback, handleGroupMessage, handleStart, handleHelp, handleConfig } = require('./src/utils/handlers');

// ... db connect ...

const bot = new Telegraf(config.BOT_TOKEN);

// Commands
bot.start(handleStart);
bot.help(handleHelp);
bot.command('stats', handleStats);
bot.command('broadcast', handleBroadcast);

// ✅ NEW COMMANDS
bot.command('setup_api', handleConfig);
bot.command('mode', handleConfig);

// Logic
bot.on('text', async (ctx, next) => {
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        await handleGroupMessage(ctx, () => handleMessage(ctx));
    } else {
        handleMessage(ctx);
    }
});

bot.on('callback_query', handleCallback);

// ✅ START POLLER
poller.init(bot);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

setupServer(bot);
