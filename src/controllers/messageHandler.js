const { Markup } = require('telegraf');
const config = require('../config/settings');
const extractor = require('../services/extractors');
const { resolveRedirect } = require('../utils/helpers');
const downloader = require('../utils/downloader');

const generateCaption = (text, platform, sourceUrl) => {
    const cleanText = text ? text.trim() : "Media Content";
    const safeText = cleanText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<b>🎬 ${platform} Media</b> | <a href="${sourceUrl}">Source</a>\n\n<blockquote>${safeText}</blockquote>`;
};

const handleMessage = async (ctx) => {
    const messageText = ctx.message.text;
    const match = messageText.match(config.URL_REGEX);
    if (!match) return;

    const inputUrl = match[0];
    let customCaption = messageText.replace(inputUrl, '').trim();

    const msg = await ctx.reply("🔍 *Analyzing...*", { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });

    try {
        const fullUrl = await resolveRedirect(inputUrl);
        let media = await extractor.extract(fullUrl);
        if (!media) throw new Error("Media not found");

        // Twitter-এর ক্ষেত্রে অনেক সময় থামনেইল না থাকলে yt-dlp থেকে নেওয়ার চেষ্টা
        if (!media.thumbnail && (fullUrl.includes('x.com') || fullUrl.includes('twitter'))) {
            try {
                const info = await downloader.getInfo(fullUrl);
                media.thumbnail = info.thumbnail;
            } catch (e) {}
        }

        let platform = 'Social';
        if (fullUrl.includes('reddit')) platform = 'Reddit';
        else if (fullUrl.includes('twitter') || fullUrl.includes('x.com')) platform = 'Twitter';
        else if (fullUrl.includes('tiktok')) platform = 'TikTok';
        else if (fullUrl.includes('instagram')) platform = 'Instagram';

        const htmlCaption = generateCaption(customCaption || media.title, platform, fullUrl);

        const buttons = [];
        if (media.type === 'gallery') buttons.push([Markup.button.callback(`📥 Download Album`, `alb|all`)]);
        else if (media.type === 'image') buttons.push([Markup.button.callback(`🖼 Download Image`, `img|single`)]);
        else if (media.type === 'video') {
            if (media.formats?.length > 0 && !fullUrl.includes('tiktok')) {
                const fmts = media.formats.filter(f => f.ext === 'mp4' && f.height).sort((a,b) => b.height - a.height).slice(0, 5);
                fmts.forEach(f => {
                    if(!buttons.some(b => b[0].text.includes(f.height)))
                        buttons.push([Markup.button.callback(`📹 ${f.height}p`, `vid|${f.format_id}`)]);
                });
            }
            if (buttons.length === 0) buttons.push([Markup.button.callback("📹 Download Video", `vid|best`)]);
            buttons.push([Markup.button.callback("🎵 Audio Only", "aud|best")]);
        }

        const menu = Markup.inlineKeyboard(buttons);

        // যদি থামনেইল থাকে তবে ফটো হিসেবে প্রিভিউ পাঠাবে
        if (media.thumbnail) {
            await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
            await ctx.replyWithPhoto(media.thumbnail, { caption: htmlCaption, parse_mode: 'HTML', ...menu });
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, htmlCaption, { parse_mode: 'HTML', disable_web_page_preview: true, ...menu });
        }

    } catch (e) {
        console.error(e);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "❌ Failed. Content unavailable.");
    }
};

module.exports = { handleMessage };
