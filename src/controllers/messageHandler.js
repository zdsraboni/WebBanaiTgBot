const { Markup } = require('telegraf');
const config = require('../config/settings');
const extractor = require('../services/extractors');
const { resolveRedirect } = require('../utils/helpers');
const db = require('../utils/db'); // IMPORT DB

const handleMessage = async (ctx) => {
    const match = ctx.message.text.match(config.URL_REGEX);
    if (!match) return;

    const url = match[0];

    // --- 1. CACHE CHECK (The Fast Lane) ---
    // If we have seen this link before, send it instantly
    const cached = db.getCache(url);
    if (cached) {
        console.log(`⚡ Cache Hit for: ${url}`);
        db.addCacheHit();
        
        try {
            if (cached.type === 'video') return await ctx.replyWithVideo(cached.id, { caption: '⚡ Instant Cache' });
            if (cached.type === 'photo') return await ctx.replyWithPhoto(cached.id, { caption: '⚡ Instant Cache' });
            if (cached.type === 'audio') return await ctx.replyWithAudio(cached.id, { caption: '⚡ Instant Cache' });
        } catch (e) {
            console.log("⚠️ Cached file ID invalid (expired?), reprocessing...");
            // If cache fails (rare), we continue to download normally below
        }
    }

    console.log(`📩 New Request: ${url}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(url);
        const media = await extractor.extract(fullUrl);

        if (!media) throw new Error("Media not found");

        const buttons = [];
        let text = `✅ *${(media.title).substring(0, 50)}...*`;

        // 1. Gallery
        if (media.type === 'gallery') {
            text += `\n📚 **Album:** ${media.items.length} items`;
            buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        } 
        // 2. Image
        else if (media.type === 'image') {
            buttons.push([Markup.button.callback(`🖼 Download Image`, `img|single`)]);
        } 
        // 3. Video
        else if (media.type === 'video') {
            if (media.formats?.length > 0 && !fullUrl.includes('tiktok') && !fullUrl.includes('instagram')) {
                const formats = media.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height).slice(0, 5);
                formats.forEach(f => {
                    if(!buttons.some(b => b[0].text.includes(f.height))) 
                        buttons.push([Markup.button.callback(`📹 ${f.height}p`, `vid|${f.format_id}`)]);
                });
            }
            if (buttons.length === 0) buttons.push([Markup.button.callback("📹 Download Video", `vid|best`)]);
            buttons.push([Markup.button.callback("🎵 Audio Only", "aud|best")]);
        }

        const safeUrl = (media.type === 'video' && media.url) ? media.url : (media.source || fullUrl);
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            `${text}\n[Source](${safeUrl})`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );

    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
};

module.exports = { handleMessage };