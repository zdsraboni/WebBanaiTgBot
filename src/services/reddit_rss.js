const Parser = require('rss-parser');
const db = require('../utils/db');
const config = require('../config/settings');
const handlers = require('../utils/handlers');

// ✅ FIX: ADD CUSTOM HEADERS TO BYPASS 403
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml'
    }
});

const checkSaved = async (bot) => {
    const adminId = config.ADMIN_ID;
    const user = await db.getAdminConfig(adminId);

    if (!user || !user.redditConfig || !user.redditConfig.isActive || !user.redditConfig.rssUrl) {
        return;
    }

    try {
        console.log(`👽 Reddit RSS: Checking feed...`);
        const feed = await parser.parseURL(user.redditConfig.rssUrl);
        
        if (!feed || !feed.items || feed.items.length === 0) return;

        const newestItem = feed.items[0];
        const newestId = newestItem.id || newestItem.link; 
        
        const lastId = user.redditConfig.lastPostId;

        if (!lastId) {
            console.log(`👽 Reddit RSS: First run sync. Marking ${newestId}`);
            await db.updateRedditLastId(adminId, newestId);
            await bot.telegram.sendMessage(adminId, `✅ <b>Reddit Feed Connected!</b>\nSynced latest post.\nWaiting for NEW saved posts...`, { parse_mode: 'HTML' });
            return;
        }

        if (newestId === lastId) {
            console.log("💤 Reddit RSS: No new posts.");
            return; 
        }

        const newPosts = [];
        for (const item of feed.items) {
            const currentId = item.id || item.link;
            if (currentId === lastId) break; 
            newPosts.unshift(item); 
        }

        if (newPosts.length > 0) {
            console.log(`🔥 Found ${newPosts.length} new Reddit posts.`);
            
            for (const post of newPosts) {
                const postUrl = post.link;
                console.log(`👽 Processing Reddit: ${postUrl}`);

                // Determine Target Chat
                const targetId = user.twitterConfig.webhookTarget || adminId;

                const mockCtx = {
                    from: { id: adminId, first_name: 'Admin' },
                    chat: { id: targetId },
                    message: { text: postUrl, message_id: 0, from: { id: adminId } },
                    reply: (text, extra) => bot.telegram.sendMessage(targetId, text, extra),
                    telegram: bot.telegram,
                    answerCbQuery: () => Promise.resolve(),
                    replyWithVideo: (v, e) => bot.telegram.sendVideo(targetId, v, e),
                    replyWithAudio: (a, e) => bot.telegram.sendAudio(targetId, a, e),
                    replyWithPhoto: (p, e) => bot.telegram.sendPhoto(targetId, p, e),
                    replyWithDocument: (d, e) => bot.telegram.sendDocument(targetId, d, e),
                    editMessageMedia: (m, e) => bot.telegram.sendVideo(targetId, m.media.source, { caption: m.caption, parse_mode: 'HTML' })
                };

                await handlers.handleMessage(mockCtx);
                await new Promise(r => setTimeout(r, 5000)); // 5s delay
            }

            await db.updateRedditLastId(adminId, newestId);
        }

    } catch (e) {
        console.error("❌ Reddit RSS Error:", e.message);
        // If it's still 403, the URL might be expired/wrong format
        if (e.message.includes('403')) {
             console.log("⚠️ Tip: Check if your RSS URL has '?feed=...' and '&user=...' parameters.");
        }
    }
};

const init = (bot) => {
    console.log("🚀 Reddit RSS Engine Started");
    checkSaved(bot);
    setInterval(() => checkSaved(bot), 2 * 60 * 1000);
};

module.exports = { init };
