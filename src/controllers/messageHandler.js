const { Markup } = require('telegraf');
const config = require('../config/settings');
const extractor = require('../services/extractors');
const { resolveRedirect } = require('../utils/helpers');

// --- HELPER: Caption Generator (From your idea) ---
const generateCaption = (text, platform, sourceUrl) => {
    // 1. Clean the text (Remove HTML tags if any to prevent breakage)
    const cleanText = text ? text.trim() : "Media Content";
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // 2. Format: Header | Source Link
    // 3. Content in Blockquote
    return `<b>🎬 ${platform} Media</b> | <a href="${sourceUrl}">Source</a>\n\n<blockquote>${safeText}</blockquote>`;
};

const handleMessage = async (ctx) => {
    const messageText = ctx.message.text;
    if (!messageText) return;

    // 1. Find URL
    const match = messageText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];

    // 2. Extract Custom Caption (Everything after the URL)
    // Example: "https://link.com My Caption" -> "My Caption"
    let customCaption = messageText.replace(inputUrl, '').trim();

    console.log(`📩 Request: ${inputUrl}`);
    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(inputUrl);
        const media = await extractor.extract(fullUrl);

        if (!media) throw new Error("Media not found");

        // 3. Determine Platform Name
        let platform = 'Social';
        if (fullUrl.includes('reddit')) platform = 'Reddit';
        else if (fullUrl.includes('x.com') || fullUrl.includes('twitter')) platform = 'Twitter';
        else if (fullUrl.includes('tiktok')) platform = 'TikTok';
        else if (fullUrl.includes('instagram')) platform = 'Instagram';

        // 4. Generate Final Caption
        // Logic: If User gave caption -> Use it. Else -> Use Media Title.
        const finalContent = customCaption ? customCaption : (media.title || 'Media Content');
        const htmlCaption = generateCaption(finalContent, platform, fullUrl);

        // 5. Build Buttons
        const buttons = [];
        if (media.type === 'gallery') {
            buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        } 
        else if (media.type === 'image') {
            buttons.push([Markup.button.callback(`🖼 Download Image`, `img|single`)]);
        } 
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

        // 6. Send Preview
        await ctx.telegram.editMessageText(
            ctx.chat.id, msg.message_id, null,
            htmlCaption, 
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