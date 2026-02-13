const { Markup } = require('telegraf');
const config = require('../config/settings');
const extractor = require('../services/extractors');
const { resolveRedirect } = require('../utils/helpers');

// --- Helper: Caption Formatter ---
const getCaption = (media, url) => {
    // 1. Identify Platform
    let platform = 'Social';
    if (url.includes('reddit')) platform = 'Reddit';
    else if (url.includes('x.com') || url.includes('twitter')) platform = 'Twitter';
    else if (url.includes('tiktok')) platform = 'TikTok';
    else if (url.includes('instagram')) platform = 'Instagram';

    // 2. Sanitize Text for HTML (Prevent errors)
    const cleanTitle = (media.title || 'No Caption')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // 3. Return Layout
    return `<b>🎬 ${platform} Media</b> | <a href="${url}">Source</a>\n\n<blockquote>${cleanTitle}</blockquote>`;
};

const handleMessage = async (ctx) => {
    const match = ctx.message.text.match(config.URL_REGEX);
    if (!match) return;

    console.log(`📩 Request: ${match[0]}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(match[0]);
        const media = await extractor.extract(fullUrl);

        if (!media) throw new Error("Media not found");

        const buttons = [];
        
        // Use the new Caption Format
        const captionText = getCaption(media, fullUrl);

        // 1. Gallery
        if (media.type === 'gallery') {
            buttons.push([Markup.button.callback(`📥 Download Album (${media.items.length})`, `alb|all`)]);
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
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            captionText, // New HTML Caption
            { 
                parse_mode: 'HTML', // Changed to HTML for blockquote support
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard(buttons) 
            }
        );

    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
};

module.exports = { handleMessage };
