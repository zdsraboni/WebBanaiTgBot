/**
 * UNIVERSAL MEDIA DOWNLOADER BOT
 * * Features:
 * - Universal support (YouTube, Insta, TikTok, X, etc.) via Cobalt API
 * - Webhook support for Render deployment
 * - Auto-detects links in messages
 * - Smart quality selection
 * - Handles split messages (photos/videos)
 * - 24/7 Keep-alive endpoint
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN; // Set this in Render Environment Variables
const URL = process.env.RENDER_EXTERNAL_URL; // Render sets this automatically
const PORT = process.env.PORT || 3000;

// List of public Cobalt instances (Fallbacks to ensure 100% uptime)
const COBALT_INSTANCES = [
    'https://api.cobalt.tools/api/json',
    'https://cobalt.kwiatekmiki.pl/api/json',
    'https://co.wuk.sh/api/json' 
];

if (!BOT_TOKEN) {
    console.error('❌ ERROR: BOT_TOKEN is missing. Check your .env or Render configs.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// --- HELPER FUNCTIONS ---

/**
 * Tries to download media using a rotation of Cobalt instances.
 */
async function fetchMedia(targetUrl, isAudioOnly = false) {
    let lastError = null;

    for (const apiBase of COBALT_INSTANCES) {
        try {
            console.log(`Trying instance: ${apiBase}`);
            const response = await axios.post(apiBase, {
                url: targetUrl,
                vCodec: 'h264',
                vQuality: '720',
                aFormat: 'mp3',
                isAudioOnly: isAudioOnly,
                dubLang: false,
                disableMetadata: true 
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                timeout: 15000 
            });

            if (response.data && (response.data.url || response.data.picker)) {
                return response.data;
            }
        } catch (error) {
            console.error(`Instance ${apiBase} failed:`, error.message);
            lastError = error;
        }
    }
    throw lastError || new Error('All instances failed');
}

// --- BOT HANDLERS ---

bot.start((ctx) => {
    ctx.reply(
        `👋 *Welcome to Universal Downloader!* \n\n` +
        `I can download media from almost any platform:\n` +
        `• YouTube, Shorts, Music\n` +
        `• Instagram (Reels, Stories, Posts)\n` +
        `• TikTok (No Watermark)\n` +
        `• Twitter / X\n` +
        `• SoundCloud, Reddit, Twitch clips, and more.\n\n` +
        `🚀 *Just send me a link to start!*`,
        { parse_mode: 'Markdown' }
    );
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);

    if (!urls) return; 

    const targetUrl = urls[0];
    const statusMsg = await ctx.reply('🔍 *Processing link...* \n_Please wait, contacting servers._', { parse_mode: 'Markdown' });

    try {
        const data = await fetchMedia(targetUrl);

        if (data.status === 'picker' && data.picker) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '📦 *Album detected!* Sending files...', { parse_mode: 'Markdown' });
            
            for (const item of data.picker) {
                if (item.type === 'photo') {
                    await ctx.replyWithPhoto(item.url);
                } else if (item.type === 'video') {
                    await ctx.replyWithVideo(item.url);
                }
            }
            return;
        }

        if (data.status === 'stream' || data.status === 'redirect' || data.url) {
            const mediaUrl = data.url;
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⬇️ *Downloading...*', { parse_mode: 'Markdown' });

            try {
                await ctx.replyWithVideo(mediaUrl, { caption: '✨ Downloaded via @' + ctx.botInfo.username });
            } catch (videoError) {
                try {
                    await ctx.replyWithPhoto(mediaUrl, { caption: '✨ Downloaded via @' + ctx.botInfo.username });
                } catch (photoError) {
                    await ctx.replyWithDocument(mediaUrl, { caption: '✨ Downloaded via @' + ctx.botInfo.username });
                }
            }
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } else {
            throw new Error('Unknown API response format');
        }

    } catch (err) {
        console.error('Download Error:', err);
        let errorText = '❌ *Download Failed.*\n\n';
        if (err.response && err.response.status === 404) {
            errorText += 'The content was not found or is private.';
        } else if (err.message.includes('timeout')) {
            errorText += 'Server timed out. Please try again.';
        } else {
            errorText += 'Make sure the link is valid and public.';
        }
        
        if (err.description && err.description.includes('file is too big')) {
             errorText = '⚠️ *File is too large for Telegram.*\n\n' + 
                         'Use this direct link to download:\n' + 
                         `[Click Here to Download](${targetUrl})`; 
        }

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, errorText, { parse_mode: 'Markdown' });
    }
});

// --- SERVER SETUP (FIXED) ---

async function startServer() {
    // 1. Telegram Webhook Route
    // This awaits inside an async function, which fixes the error
    if (URL) {
        app.use(await bot.createWebhook({ domain: URL }));
        console.log(`Webhook set to: ${URL}`);
    } else {
        console.log('Running in local mode (no webhook url found)');
    }

    // 2. Keep-Alive Route (For pinging)
    app.get('/', (req, res) => {
        res.send('Bot is running! 🚀');
    });

    // 3. Health Check
    app.get('/health', (req, res) => {
        res.status(200).json({ status: 'ok' });
    });

    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

// Start the server
startServer().catch(err => {
    console.error('Failed to start server:', err);
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
