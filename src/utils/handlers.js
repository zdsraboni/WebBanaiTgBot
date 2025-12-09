// ... existing code ...

// --- CONFIG COMMANDS ---
const handleConfig = async (ctx) => {
    if (String(ctx.from.id) !== String(config.ADMIN_ID)) return;
    const text = ctx.message.text;

    // /setup_api KEY USERNAME
    if (text.startsWith('/setup_api')) {
        const parts = text.split(' ');
        if (parts.length < 3) return ctx.reply("⚠️ Usage: `/setup_api KEY USERNAME`", { parse_mode: 'Markdown' });
        
        await db.updateApiConfig(ctx.from.id, parts[1], parts[2]);
        return ctx.reply("✅ <b>API Mode Configured!</b>\nChecking every 1 min.\nFirst run will sync IDs (no download).", { parse_mode: 'HTML' });
    }

    // /mode api OR /mode webhook
    if (text.startsWith('/mode')) {
        const mode = text.split(' ')[1];
        if (mode !== 'api' && mode !== 'webhook') return ctx.reply("⚠️ Usage: `/mode api` or `/mode webhook`", { parse_mode: 'Markdown' });
        
        await db.toggleMode(ctx.from.id, mode);
        return ctx.reply(`🔄 Mode switched to: <b>${mode.toUpperCase()}</b>`, { parse_mode: 'HTML' });
    }
};

// Update Exports
module.exports = { 
    handleMessage, handleCallback, handleGroupMessage, handleStart, handleHelp, performDownload, handleConfig 
};
