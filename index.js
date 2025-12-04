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
// You can add more from: https://instances.cobalt.tools/
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
                // Cobalt settings for better compatibility
                dubLang: false,
                disableMetadata: true 
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                timeout: 15000 // 15 second timeout per instance
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

// Handle any text message that contains a link
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);

    if (!urls) return; // Ignore messages without links

    const targetUrl = urls[0];

    // Status message
    const statusMsg = await ctx.reply('🔍 *Processing link...* \n_Please wait, contacting servers._', { parse_mode: 'Markdown' });

    try {
        const data = await fetchMedia(targetUrl);

        // 1. Handle "Picker" (Multiple items, e.g., Insta Carousel)
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

        // 2. Handle Single File
        if (data.status === 'stream' || data.status === 'redirect' || data.url) {
            const mediaUrl = data.url;
            
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⬇️ *Downloading...*', { parse_mode: 'Markdown' });

            // Determine type based on URL extension or assume video usually
            // A simplified check. Cobalt usually returns specific types but we send generic requests.
            // We try to send as video first, catch error, then document.
            
            try {
                // Try sending as Video
                await ctx.replyWithVideo(mediaUrl, { 
                    caption: '✨ Downloaded via @' + ctx.botInfo.username 
                });
            } catch (videoError) {
                try {
                    // If video fails (maybe it's an image or gif), try Photo
                    await ctx.replyWithPhoto(mediaUrl, { 
                        caption: '✨ Downloaded via @' + ctx.botInfo.username 
                    });
                } catch (photoError) {
                    // If photo fails, send as Document (fallback for audio or unknown)
                    await ctx.replyWithDocument(mediaUrl, { 
                        caption: '✨ Downloaded via @' + ctx.botInfo.username 
                    });
                }
            }

            // Delete status message
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } else {
            throw new Error('Unknown API response format');
        }

    } catch (err) {
        console.error('Download Error:', err);
        
        // Robust Error Handling
        let errorText = '❌ *Download Failed.*\n\n';
        if (err.response && err.response.status === 404) {
            errorText += 'The content was not found or is private.';
        } else if (err.message.includes('timeout')) {
            errorText += 'Server timed out. Please try again.';
        } else {
            errorText += 'Make sure the link is valid and public.';
        }
        
        // If file is too large for Telegram Bot API (50MB limit for URL upload)
        // We provide the direct link instead.
        if (err.description && err.description.includes('file is too big')) {
             errorText = '⚠️ *File is too large for Telegram.*\n\n' + 
                         'Use this direct link to download:\n' + 
                         `[Click Here to Download](${targetUrl})`; // We can't get the direct link if it failed inside replyWith, so we just inform.
        }

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, errorText, { parse_mode: 'Markdown' });
    }
});

// --- SERVER SETUP (Webhooks + Keep-Alive) ---

// 1. Telegram Webhook Route
app.use(await bot.createWebhook({ domain: URL }));

// 2. Keep-Alive Route (For pinging)
app.get('/', (req, res) => {
    res.send('Bot is running! 🚀');
});

// 3. Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

