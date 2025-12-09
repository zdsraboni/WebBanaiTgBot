const Parser = require('rss-parser');
const db = require('../utils/db');
const config = require('../config/settings');
const handlers = require('../utils/handlers');

const parser = new Parser();

const checkSaved = async (bot) => {
    const adminId = config.ADMIN_ID;
    const user = await db.getAdminConfig(adminId);

    // 1. Check Config
    if (!user || !user.redditConfig || !user.redditConfig.isActive || !user.redditConfig.rssUrl) {
        return;
    }

    try {
        // 2. Fetch RSS Feed
        // Reddit feeds are public/tokenized, so standard fetch works
        const feed = await parser.parseURL(user.redditConfig.rssUrl);
        
        if (!feed || !feed.items || feed.items.length === 0) return;

        // 3. Sync Logic
        // The first item in the feed is the newest
        const newestItem = feed.items[0];
        const newestId = newestItem.id || newestItem.link; // Reddit RSS uses link as ID often
        
        const lastId = user.redditConfig.lastPostId;

        // First Run: Just save the ID to avoid spamming old saved posts
        if (!lastId) {
            console.log(`👽 Reddit RSS: First run sync. Marking ${newestId}`);
            await db.updateRedditLastId(adminId, newestId);
            await bot.telegram.sendMessage(adminId, `✅ <b>Reddit Feed Connected!</b>\nSynced latest post.\nWaiting for NEW saved posts...`, { parse_mode: 'HTML' });
            return;
        }

        // Check if newest is actually new
        if (newestId === lastId) {
            return; // No updates
        }

        // 4. Find all new items (Filter those newer than lastId)
        // RSS feed order: Newest [0] -> Oldest [n]
        // We iterate and stop when we hit the lastId
        const newPosts = [];
        for (const item of feed.items) {
            const currentId = item.id || item.link;
            if (currentId === lastId) break; // Reached known territory
            newPosts.unshift(item); // Add to list (reversed to process oldest new first)
        }

        if (newPosts.length > 0) {
            console.log(`🔥 Found ${newPosts.length} new Reddit posts.`);
            
            // Process them
            for (const post of newPosts) {
                const postUrl = post.link;
                console.log(`👽 Processing Reddit: ${postUrl}`);

                // Determine Target Chat
                const targetId = user.twitterConfig.webhookTarget || adminId; // Reuse destination setting

                // Mock Context
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

                // Trigger Download
                await handlers.handleMessage(mockCtx);
                
                // Delay to prevent flood
                await new Promise(r => setTimeout(r, 3000));
            }

            // Update DB with the newest ID we processed
            await db.updateRedditLastId(adminId, newestId);
        }

    } catch (e) {
        console.error("❌ Reddit RSS Error:", e.message);
    }
};

const init = (bot) => {
    console.log("🚀 Reddit RSS Engine Started");
    checkSaved(bot);
    // Check every 2 minutes
    setInterval(() => checkSaved(bot), 2 * 60 * 1000);
};

module.exports = { init };