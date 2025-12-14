const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process'); // Needed for Python
const config = require('../config/settings');
const { translate } = require('google-translate-api-x');
const db = require('./db');
const { resolveRedirect } = require('./helpers'); 
const downloader = require('./downloader');
const redditService = require('../services/reddit');
const twitterService = require('../services/twitter');

// --- GLOBALS ---
let pythonProcess = null;      // For the running bot (/run)
let activeLoginProcess = null; // For the login session (/login)

// --- HELPERS ---
const getFlagEmoji = (code) => {
    if (!code || code.length !== 2) return '🇧🇩';
    return code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
};

const generateCaption = (text, platform, sourceUrl, flagEmoji) => {
    const cleanText = text ? (text.length > 900 ? text.substring(0, 897) + '...' : text) : "Media Content";
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const validFlag = flagEmoji || '🇧🇩';
    return `🎬 <b>${platform} media</b> | <a href="${sourceUrl}">source</a> ${validFlag}\n\n<blockquote>${safeText}</blockquote>`;
};

const getTranslationButtons = () => {
    return Markup.inlineKeyboard([[Markup.button.callback('🇺🇸 English', 'trans|en'), Markup.button.callback('🇧🇩 Bangla', 'trans|bn')]]);
};

// --- START & HELP ---
const handleStart = async (ctx) => {
    db.addUser(ctx);
    const text = `👋 <b>Welcome to Media Banai!</b>\nI can download from Twitter, Reddit, Instagram & TikTok.\n\n<b>Features:</b>\n• Auto-Split Large Files\n• Real Thumbnails\n• Translation`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('📚 Help', 'help_msg'), Markup.button.callback('📊 Stats', 'stats_msg')]]);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    else await ctx.reply(text, { parse_mode: 'HTML', ...buttons });
};

const handleHelp = async (ctx) => {
    const text = `📚 <b>Help Guide</b>\n\n<b>1. Downloads:</b> Send any valid link.\n<b>2. Autoforward:</b>\n   • <code>/setup_host API_ID API_HASH</code>\n   • <code>/login</code> (Interactive Login)\n   • <code>/run autoforward</code>`;
    const buttons = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'start_msg')]]);
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', ...buttons }).catch(()=>{});
    else await ctx.reply(text, { parse_mode: 'HTML' });
};

// --- ✅ CONFIG & SETUP COMMANDS ---
const handleConfig = async (ctx) => {
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;
    const text = ctx.message.text;

    // 1. SETUP HOST (Store API ID/Hash)
    if (text.startsWith('/setup_host')) {
        const parts = text.split(' ');
        if (parts.length < 3) return ctx.reply("⚠️ Usage: `/setup_host API_ID API_HASH`", { parse_mode: 'Markdown' });
        
        await db.updateAutoforwardCreds(ctx.from.id, parts[1], parts[2]);
        return ctx.reply(`✅ <b>Credentials Saved!</b>\nNow send <code>/login</code> to generate session.`, { parse_mode: 'HTML' });
    }

    // 2. REDDIT Config
    if (text.startsWith('/setup_reddit')) {
        const parts = text.split(' ');
        if (parts.length < 2) return ctx.reply("⚠️ Usage: `/setup_reddit RSS_URL`", { parse_mode: 'Markdown' });
        await db.updateRedditConfig(ctx.from.id, parts[1]);
        return ctx.reply("✅ <b>Reddit Feed Configured!</b>", { parse_mode: 'HTML' });
    }
    // ... (Keep other config commands like before) ...
    if (text.startsWith('/set_destination')) {
        let targetId = ctx.chat.id;
        let title = ctx.chat.title || "Private Chat";
        if (text.includes('reset')) { targetId = ""; title = "Default (Private)"; }
        await db.setWebhookTarget(config.ADMIN_ID, targetId);
        return ctx.reply(`✅ <b>Destination Updated!</b>\nTarget: <b>${title}</b>`, { parse_mode: 'HTML' });
    }
    if (text.startsWith('/setup_api')) {
        const parts = text.split(' ');
        if (parts.length < 3) return ctx.reply("⚠️ Usage: `/setup_api KEY USER`", { parse_mode: 'Markdown' });
        await db.updateApiConfig(ctx.from.id, parts[1], parts[2]);
        return ctx.reply("✅ <b>Twitter API Configured!</b>", { parse_mode: 'HTML' });
    }
    if (text.startsWith('/mode')) {
        const mode = text.split(' ')[1];
        await db.toggleMode(ctx.from.id, mode);
        return ctx.reply(`🔄 Mode: <b>${mode}</b>`, { parse_mode: 'HTML' });
    }
};

// --- ✅ NEW: INTERACTIVE LOGIN (/login) ---
const handleLogin = async (ctx) => {
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;
    if (activeLoginProcess) return ctx.reply("⚠️ Login process already active! Check logs.");

    const userConfig = await db.getAdminConfig(config.ADMIN_ID);
    if (!userConfig || !userConfig.autoforwardConfig || !userConfig.autoforwardConfig.apiId) {
        return ctx.reply("❌ <b>No Credentials Found!</b>\nPlease use <code>/setup_host API_ID API_HASH</code> first.", { parse_mode: 'HTML' });
    }

    await ctx.reply("☎️ <b>Starting Login Session...</b>\nPlease wait for the prompt to enter your phone number.", { parse_mode: 'HTML' });

    const scriptPath = path.join(__dirname, '../../autoforward/session.py');
    
    // Spawn Python with -u (Unbuffered) so we get output instantly
    activeLoginProcess = spawn('python3', ['-u', scriptPath], {
        env: { 
            ...process.env, 
            // Pass Stored Credentials to Script
            API_ID: userConfig.autoforwardConfig.apiId,
            API_HASH: userConfig.autoforwardConfig.apiHash
        }
    });

    // 1. Capture Output (Prompts)
    activeLoginProcess.stdout.on('data', async (data) => {
        const output = data.toString();
        console.log(`[Session]: ${output}`);

        // Detect Session String Success
        if (output.includes('1BVts') || output.length > 200) {
            // It's likely the session string! Save it.
            // We assume the script prints ONLY the session string at the end or we parse it
            // Simple logic: if long string, save it.
            const possibleSession = output.trim();
            if (possibleSession.length > 50) {
                await db.updateAutoforwardSession(config.ADMIN_ID, possibleSession);
                await ctx.reply("✅ <b>Session Generated & Saved!</b>\nYou can now use <code>/run autoforward</code>.", { parse_mode: 'HTML' });
                activeLoginProcess.kill();
                activeLoginProcess = null;
                return;
            }
        }

        // Forward prompts to user
        if (output.toLowerCase().includes('phone') || output.toLowerCase().includes('code') || output.toLowerCase().includes('password')) {
            await ctx.reply(`🔑 <b>Script says:</b>\n${output}`, { parse_mode: 'HTML' });
        }
    });

    activeLoginProcess.stderr.on('data', (data) => {
        console.error(`[Session Error]: ${data}`);
    });

    activeLoginProcess.on('close', (code) => {
        console.log(`[Session] Closed: ${code}`);
        activeLoginProcess = null;
        if (code !== 0 && code !== null) ctx.reply("❌ Login Script Stopped.");
    });
};

// --- ✅ MODIFIED: RUN COMMAND (/run) ---
const handleRun = async (ctx) => {
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;
    const text = ctx.message.text.trim(); 

    if (!text.includes('autoforward')) return ctx.reply("⚠️ Usage: <code>/run autoforward</code>", { parse_mode: 'HTML' });
    if (pythonProcess) return ctx.reply("⚠️ Script already running!");

    // Fetch Credentials from DB
    const userConfig = await db.getAdminConfig(config.ADMIN_ID);
    const afConfig = userConfig?.autoforwardConfig;

    if (!afConfig || !afConfig.sessionString) {
        return ctx.reply("❌ <b>Missing Session!</b>\nPlease run <code>/login</code> first.", { parse_mode: 'HTML' });
    }

    await ctx.reply("🚀 <b>Starting Autoforward...</b>", { parse_mode: 'HTML' });

    const scriptPath = path.join(__dirname, '../../autoforward/main.py');
    pythonProcess = spawn('python3', ['-u', scriptPath], {
        env: { 
            ...process.env, 
            PORT: '8081',
            API_ID: afConfig.apiId,
            API_HASH: afConfig.apiHash,
            SESSION_STRING: afConfig.sessionString
        } 
    });

    pythonProcess.stdout.on('data', (data) => console.log(`🐍 [Bot]: ${data}`));
    pythonProcess.stderr.on('data', (data) => console.error(`🐍 [Err]: ${data}`));
    pythonProcess.on('close', (code) => {
        pythonProcess = null;
        ctx.reply(`⚠️ <b>Stopped</b> (Code: ${code})`, { parse_mode: 'HTML' });
    });
};

// --- MAIN MESSAGE HANDLER (UPDATED FOR INTERACTIVE LOGIN) ---
const handleMessage = async (ctx) => {
    // 🔴 INTERCEPT: If Login Process is Active, pipe message to Python
    if (activeLoginProcess && String(ctx.from.id) === String(config.ADMIN_ID)) {
        const input = ctx.message.text;
        if (input) {
            console.log(`[Sending to Python]: ${input}`);
            activeLoginProcess.stdin.write(input + "\n"); // Write to Python's Input
            return; // Stop here, don't download
        }
    }

    // Normal Logic
    db.addUser(ctx);
    const messageText = ctx.message.text;
    if (!messageText) return; 
    const match = messageText.match(config.URL_REGEX);
    if (!match) return;

    // ... (Keep existing download logic exactly as before) ...
    // ... I will skip pasting the huge download block to save space ...
    // ... Assume performDownload and logic is here ...
    // Just ensure you paste the download logic from previous `handlers.js` here.
    
    // FOR SAFETY, I will call the helper we used before or you keep your old code block here.
    // Assuming you kept the old logic:
    const inputUrl = match[0];
    await performDownload(ctx, inputUrl, false, 'best', await ctx.reply("🔍 Analyzing...").then(m=>m.message_id), messageText, ctx.message.message_id);
};

// ... (Keep Group Message / Callback handlers same) ...
// We need to re-export handleLogin and handleSetupHost
// ...

// EXPORT
module.exports = { 
    handleMessage, handleCallback, handleGroupMessage, handleStart, handleHelp, 
    performDownload, handleConfig, handleEditCaption, handleForward, 
    handleRun, handleLogin // <--- Exported
};
