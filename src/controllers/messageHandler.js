const { Markup } = require('telegraf');
const config = require('../config/settings');
const extractor = require('../services/extractors');
const { resolveRedirect, formatBytes } = require('../utils/helpers'); // Import formatBytes
const db = require('../utils/db');

const handleMessage = async (ctx) => {
    const match = ctx.message.text.match(config.URL_REGEX);
    if (!match) return;

    const url = match[0];

    // 1. Cache Check
    const cached = db.getCache(url);
    if (cached) {
        console.log(`⚡ Cache Hit for: ${url}`);
        db.addCacheHit();
        try {
            if (cached.type === 'video') return await ctx.replyWithVideo(cached.id, { caption: '⚡ Instant Cache' });
            if (cached.type === 'photo') return await ctx.replyWithPhoto(cached.id, { caption: '⚡ Instant Cache' });
            if (cached.type === 'audio') return await ctx.replyWithAudio(cached.id, { caption: '⚡ Instant Cache' });
        } catch (e) {}
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
        // 3. Video (With Quality Choice)
        else if (media.type === 'video') {
            let hasQualities = false;

            if (media.formats && media.formats.length > 0) {
                // Filter MP4s, sort by resolution (High to Low)
                const formats = media.formats
                    .filter(f => f.ext === 'mp4' && f.height)
                    .sort((a, b) => b.height - a.height);

                const seenHeights = new Set();

                formats.forEach(f => {
                    // Only show unique heights (e.g. one 1080p, one 720p)
                    // and limit to 5 buttons max
                    if (!seenHeights.has(f.height) && seenHeights.size < 5) {
                        seenHeights.add(f.height);
                        
                        const sizeStr = f.filesize ? formatBytes(f.filesize) : (f.filesize_approx ? formatBytes(f.filesize_approx) : 'Unknown');
                        const btnText = `📹 ${f.height}p (${sizeStr})`;
                        
                        buttons.push([Markup.button.callback(btnText, `vid|${f.format_id}`)]);
                    }
                });

                if (seenHeights.size > 0) hasQualities = true;
            }

            // Fallback if no qualities found
            if (!hasQualities) {
                buttons.push([Markup.button.callback("📹 Download Video", `vid|best`)]);
            }
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