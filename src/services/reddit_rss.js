const Parser = require('rss-parser');
const db = require('../utils/db');
const config = require('../config/settings');
const handlers = require('../utils/handlers');

// ✅ FIX: ADD CUSTOM HEADERS TO BYPASS 403
// We pretend to be a standard Android Browser
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml'
    }
});

const checkSaved = async (bot) => {
    const adminId = config.ADMIN_ID;
    const user = await db.getAdminConfig(adminId);

    // 1. Check Config
    if (!user || !user.redditConfig || !user.redditConfig.isActive || !user.redditConfig.rssUrl) {
        return;
    }

    try {
        console.log(`👽 Reddit RSS: Checking feed...`);
        
        // 2. Fetch Feed
        const feed = await parser.parseURL(user.redditConfig.rssUrl);
        
        if (!feed || !feed.items || feed.items.length === 0) return;

        // 3. Logic to find new posts
        const newestItem = feed.items[0];
        const newestId = newestItem.id || newestItem.link; 
        
        const lastId = user.redditConfig.lastPostId;

        // First Run: Just sync, don't download old stuff
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

        // 4. Process New Posts
        const newPosts = [];
        for (const item of feed.items) {
            const currentId = item.id || item.link;
            if (currentId === lastId) break; // Stop if we hit the known post
            newPosts.unshift(item); // Add to list
        }

        if (newPosts.length > 0) {
            console.log(`🔥 Found ${newPosts.length} new Reddit posts.`);
            
            for (const post of newPosts) {
                const postUrl = post.link;
                console.log(`👽 Processing Reddit: ${postUrl}`);

                // Determine Target Chat
                const targetId = user.twitterConfig.webhookTarget || adminId;

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

                // Trigger Download Logic
                await handlers.handleMessage(mockCtx);
                
                // 5s Delay to prevent flood
                await new Promise(r => setTimeout(r, 5000));
            }

            // Update DB
            await db.updateRedditLastId(adminId, newestId);
        }

    } catch (e) {
        console.error("❌ Reddit RSS Error:", e.message);
        // Hint for user if URL is wrong
        if (e.message.includes('403')) {
             console.log("⚠️ Tip: Check if your RSS URL has '?feed=...' and '&user=...' parameters.");
        }
    }
};

const init = (bot) => {
    console.log("🚀 Reddit RSS Engine Started");
    checkSaved(bot);
    setInterval(() => checkSaved(bot), 2 * 60 * 1000); // Check every 2 mins
};

module.exports = { init };