const { Markup } = require('telegraf');
const config = require('../config/settings');
const extractor = require('../services/extractors');
const { resolveRedirect } = require('../utils/helpers');

// --- Helper: Caption Generator ---
const getCaption = (media, url, userCaption) => {
    // 1. Identify Platform
    let platform = 'Social';
    if (url.includes('reddit')) platform = 'Reddit';
    else if (url.includes('x.com') || url.includes('twitter')) platform = 'Twitter';
    else if (url.includes('tiktok')) platform = 'TikTok';
    else if (url.includes('instagram')) platform = 'Instagram';

    // 2. Decide Caption Source (User input OR Original Title)
    // If user provided text, use it. Otherwise use media title.
    const finalCaptionText = userCaption ? userCaption : (media.title || 'No Caption');

    // 3. Sanitize Text for HTML (Crucial to prevent errors)
    const cleanTitle = finalCaptionText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // 4. Return HTML Layout
    return `<b>🎬 ${platform} Media</b> | <a href="${url}">Source</a>\n\n<blockquote>${cleanTitle}</blockquote>`;
};

const handleMessage = async (ctx) => {
    const text = ctx.message.text;
    const match = text.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    
    // --- NEW LOGIC: Extract User's Custom Caption ---
    // Remove the URL from the full message text to get the caption
    // Example: "https://link.com My Custom Text" -> "My Custom Text"
    let userCaption = text.replace(inputUrl, '').trim();

    console.log(`📩 Request: ${inputUrl}`);
    if(userCaption) console.log(`📝 Custom Caption: ${userCaption}`);

    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(inputUrl);
        const media = await extractor.extract(fullUrl);

        if (!media) throw new Error("Media not found");

        const buttons = [];
        
        // Generate formatted caption
        const captionText = getCaption(media, fullUrl, userCaption);

        // 1. Gallery
        if (media.type === 'gallery') {
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
        
        // Send the Preview with HTML Caption
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            captionText, 
            { 
                parse_mode: 'HTML',
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
