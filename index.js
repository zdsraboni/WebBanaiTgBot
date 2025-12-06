const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Modules
const config = require('./src/config/settings');
const logger = require('./src/utils/logger');
const db = require('./src/utils/db');
const extractor = require('./src/services/extractors');
const downloader = require('./src/utils/downloader');
const messageHandler = require('./src/controllers/messageHandler');
const callbackHandler = require('./src/controllers/callbackHandler');
const webServer = require('./src/server/web');
const { version } = require('./package.json');

// Init Logger
logger.init();

const bot = new Telegraf(config.BOT_TOKEN);
const app = express();

// Ensure Directories
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });

// --- MIDDLEWARE: TRACK USERS ---
bot.use(async (ctx, next) => {
    if (ctx.from) db.addUser(ctx.from.id);
    await next();
});

// --- COMMANDS ---

bot.start((ctx) => ctx.reply(
    `👋 **Media Banai Bot v${version}**\n\n` +
    `✅ Reddit, Twitter (X)\n` +
    `✅ Instagram, TikTok\n` +
    `✅ Spotify, SoundCloud\n\n` +
    `🚀 **Send a link to start!**\n` +
    `Type /help for more info.`
));

bot.command('help', (ctx) => {
    ctx.reply(
        "📚 **User Guide**\n\n" +
        "1. **Send a Link:** Paste any link from Reddit, Twitter, Insta, TikTok, or Music apps.\n" +
        "2. **Select Quality:** For videos, choose 1080p/720p if available.\n" +
        "3. **Albums:** Click 'Download Album' to get all images/videos in a post.\n" +
        "4. **Music:** Use 'Download Audio' to get MP3s with cover art.\n\n" +
        "⚡ **Pro Tip:** Type `@MediaBanaiTgBot <link>` in any chat to download instantly without joining the bot!",
        { parse_mode: 'Markdown' }
    );
});

bot.command('stats', (ctx) => {
    const s = db.getStats();
    ctx.reply(`📊 **Bot Statistics**\n\n👥 Users: ${db.getUserCount()}\n⬇️ Downloads: ${s.downloads}\n⚡ Cache Hits: ${s.cacheHits}`);
});

// --- INLINE MODE ---
bot.on('inline_query', async (ctx) => {
    const q = ctx.inlineQuery.query;
    if (!q) return;

    // Check Cache
    const cached = db.getCache(q);
    const results = [];

    if (cached) {
        // If cached, return file directly
        if (cached.type === 'video') {
            results.push({
                type: 'video',
                id: 'cached_vid',
                video_file_id: cached.id,
                title: '⚡ Instant Download (Cached)',
                description: 'Send this video immediately'
            });
        } else if (cached.type === 'photo') {
            results.push({
                type: 'photo',
                id: 'cached_img',
                photo_file_id: cached.id,
                title: '⚡ Instant Download (Cached)'
            });
        }
    } else {
        // If not cached, provide a "Download" button
        results.push({
            type: 'article',
            id: 'dl_btn',
            title: '⬇️ Download Media',
            description: 'Click to process this link via the bot',
            input_message_content: { message_text: `/start ${Buffer.from(q).toString('base64')}` },
            reply_markup: {
                inline_keyboard: [[{ text: "🚀 Download Now", url: `https://t.me/${ctx.botInfo.username}?start=${Buffer.from(q).toString('base64')}` }]]
            }
        });
    }

    return ctx.answerInlineQuery(results, { cache_time: 0 });
});

// --- MAIN HANDLERS ---

// Handle deep linking from inline mode
bot.on('text', async (ctx, next) => {
    let inputText = ctx.message.text;
    if (inputText.startsWith('/start ')) {
        try { 
            // Decode base64 link from inline button
            const payload = inputText.split(' ')[1];
            inputText = Buffer.from(payload, 'base64').toString('ascii'); 
            ctx.message.text = inputText; // Update text for the handler
        } catch(e) {}
    }
    // Pass to the controller
    return messageHandler.handleMessage(ctx);
});

bot.on('callback_query', callbackHandler.handleCallback);

// --- START SERVER ---
webServer.start(bot);

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));