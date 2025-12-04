require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

// Matches Reddit and Twitter/X links
const URL_REGEX = /(https?:\/\/(?:www\.|old\.|mobile\.)?(?:reddit\.com|x\.com|twitter\.com)\/[^\s]+)/i;

// --- CRITICAL FIX: REDIRECT RESOLVER ---
// This function turns the blocked "/s/" links into real links using fake headers
const resolveRedditLink = async (url) => {
    if (!url.includes('/s/')) return url; // If it's already a full link, skip
    
    try {
        console.log("🔄 Resolving short link:", url);
        // We use Node's native fetch with a fake User-Agent to trick Reddit
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'manual', // Stop auto-redirect so we can grab the location
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (location) {
                console.log("✅ Resolved to:", location);
                return location; // Return the real, long URL
            }
        }
        return url; // Fallback
    } catch (error) {
        console.error("Link resolution failed:", error);
        return url;
    }
};

const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return 'Unknown';
    const k = 1024;
    const sizes = ['MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    // We only care about MB/GB usually
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i] || 'Bytes'}`;
};

const runYtDlp = async (args) => {
    // Heavy stealth flags to look like a Windows PC
    const cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist --add-header "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --add-header "Referer:https://www.google.com/" ${args}`;
    const { stdout } = await execPromise(cmd);
    return stdout;
};

// --- BOT LOGIC ---

bot.start((ctx) => ctx.reply("👋 I am ready! Send me a Reddit or Twitter link."));

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const match = text.match(URL_REGEX);
    if (!match) return;

    const msg = await ctx.reply("🔍 *Processing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        let url = match[0];

        // 1. Resolve Reddit Short Links
        if (url.includes('reddit.com') && url.includes('/s/')) {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "🔗 *Resolving Redirect...*", { parse_mode: 'Markdown' });
            url = await resolveRedditLink(url);
        }

        // 2. Get Info
        // We use -J to get JSON metadata
        const jsonOutput = await runYtDlp(`-J "${url}"`);
        const info = JSON.parse(jsonOutput);

        // 3. Process Qualities
        const formats = (info.formats || []).filter(f => f.ext === 'mp4' && f.height);
        
        // Remove duplicates
        const uniqueQualities = [];
        const seenHeights = new Set();
        formats.sort((a, b) => b.height - a.height);

        for (const fmt of formats) {
            if (!seenHeights.has(fmt.height)) {
                seenHeights.add(fmt.height);
                uniqueQualities.push({
                    height: fmt.height,
                    filesize: fmt.filesize || fmt.filesize_approx || 0,
                    id: fmt.format_id
                });
            }
        }

        const buttons = [];
        uniqueQualities.slice(0, 5).forEach(q => {
            // Using a shorter ID format to avoid Telegram 64-byte limit error
            // Data format: v|height|format_id
            buttons.push([Markup.button.callback(`📹 ${q.height}p`, `v|${q.height}|${q.id}`)]);
        });
        buttons.push([Markup.button.callback("🎵 Audio Only", "a|mp3|mp3")]);

        // IMPORTANT: We attach the resolved URL to the message text so we can find it later
        // We hide it in a "text link" with a zero-width space or just append it visibly
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            msg.message_id,
            null,
            `✅ *${info.title.substring(0, 50)}...*\n\nSource: [Link](${url})\nChoose quality:`,
            { 
                parse_mode: 'Markdown', 
                ...Markup.inlineKeyboard(buttons) 
            }
        );

    } catch (err) {
        console.error(err);
        // If it fails, we try to guess it's a 403 or 404
        let errorMsg = "❌ Failed. The link might be private or blocked.";
        if (err.message && err.message.includes('403')) {
            errorMsg = "❌ Reddit blocked the request. Try sending the full link (not the /s/ one) if possible.";
        }
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, errorMsg);
    }
});

bot.on('callback_query', async (ctx) => {
    // Data format: type|height|id
    const dataParts = ctx.callbackQuery.data.split('|');
    const type = dataParts[0];
    const label = dataParts[1]; // Height or 'mp3'
    const formatId = dataParts[2];

    // Recover URL from the message entities
    const entities = ctx.callbackQuery.message.entities || [];
    const linkEntity = entities.find(e => e.type === 'text_link');
    const url = linkEntity ? linkEntity.url : null;

    if (!url) {
        // Fallback: Try to get it from the original message reply
        const original = ctx.callbackQuery.message.reply_to_message;
        if (original && original.text) {
             const match = original.text.match(URL_REGEX);
             if (match) {
                 // Note: If we fall back to original text, it might be the short link again
                 // Ideally we want the resolved one from the entity, but this is a safety net.
                 await ctx.answerCbQuery("⚠️ Using original link...");
                 return handleDownload(ctx, match[0], type, label, formatId);
             }
        }
        return ctx.answerCbQuery("❌ Link expired. Please resend.");
    }

    await handleDownload(ctx, url, type, label, formatId);
});

async function handleDownload(ctx, url, type, label, formatId) {
    await ctx.answerCbQuery("🚀 Starting...");
    await ctx.editMessageText(`⏳ *Downloading ${label}...*`, { parse_mode: 'Markdown' });

    const timestamp = Date.now();
    const basePath = path.join(downloadDir, `${timestamp}`);
    let finalFile;

    try {
        if (type === 'a') {
            finalFile = `${basePath}.mp3`;
            await runYtDlp(`-x --audio-format mp3 -o "${basePath}.%(ext)s" "${url}"`);
        } else {
            finalFile = `${basePath}.mp4`;
            // Download specific video + best audio and merge
            await runYtDlp(`-f ${formatId}+bestaudio/best -S vcodec:h264 --merge-output-format mp4 -o "${basePath}.%(ext)s" "${url}"`);
        }

        const stats = fs.statSync(finalFile);
        const sizeMB = stats.size / (1024 * 1024);

        if (sizeMB > 49.5) {
            await ctx.editMessageText(`⚠️ File is ${sizeMB.toFixed(1)}MB. Telegram limits bots to 50MB.`);
        } else {
            await ctx.editMessageText("📤 *Uploading...*", { parse_mode: 'Markdown' });
            if (type === 'a') {
                await ctx.replyWithAudio({ source: finalFile }, { caption: '🎵 Audio Extracted' });
            } else {
                await ctx.replyWithVideo({ source: finalFile }, { caption: `🎥 ${label}p Video` });
            }
            await ctx.deleteMessage(); 
        }
    } catch (e) {
        console.error("Download Error:", e);
        await ctx.editMessageText("❌ Download failed. The server was blocked.");
    } finally {
        if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);
    }
}

if (process.env.NODE_ENV === 'production') {
    bot.launch({ webhook: { domain: URL, port: PORT } }).then(() => console.log(`🚀 Webhook active: ${URL}`));
} else {
    bot.launch();
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
