const Parser = require('rss-parser');
const axios = require('axios'); // ✅ Use Axios for fetching
const db = require('../utils/db');
const config = require('../config/settings');
const handlers = require('../utils/handlers');

const parser = new Parser();

const checkSaved = async (bot) => {
    const adminId = config.ADMIN_ID;
    const user = await db.getAdminConfig(adminId);

    if (!user || !user.redditConfig || !user.redditConfig.isActive || !user.redditConfig.rssUrl) {
        return;
    }

    try {
        console.log(`👽 Reddit RSS: Checking feed...`);
        
        // ✅ STEP 1: FETCH WITH AXIOS (Bypasses 403)
        // We pretend to be a real Windows PC using Chrome
        const { data } = await axios.get(user.redditConfig.rssUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });

        // ✅ STEP 2: PARSE THE DATA
        const feed = await parser.parseString(data);
        
        if (!feed || !feed.items || feed.items.length === 0) return;

        // 3. Logic to find new posts
        const newestItem = feed.items[0];
        // Reddit uses the 'link' as the ID in RSS often, or 'id' tag
        const newestId = newestItem.id || newestItem.link; 
        
        const lastId = user.redditConfig.lastPostId;

        // First Run
        if (!lastId) {
            console.log(`👽 Reddit RSS: First run. Marking start: ${newestId}`);
            await db.updateRedditLastId(adminId, newestId);
            await bot.telegram.sendMessage(adminId, `✅ <b>Reddit Connected!</b>\nSynced. Waiting for new saves...`, { parse_mode: 'HTML' });
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
            if (currentId === lastId) break; 
            newPosts.unshift(item); 
        }

        if (newPosts.length > 0) {
            console.log(`🔥 Found ${newPosts.length} new Reddit posts.`);
            
            for (const post of newPosts) {
                const postUrl = post.link;
                console.log(`👽 Processing: ${postUrl}`);

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
                await new Promise(r => setTimeout(r, 5000));
            }

            await db.updateRedditLastId(adminId, newestId);
        }

    } catch (e) {
        console.error("❌ Reddit RSS Error:", e.message);
        if (e.response && e.response.status === 403) {
            console.log("⚠️ Still 403? Try changing 'old.reddit.com' to 'www.reddit.com' in your link.");
        }
    }
};

const init = (bot) => {
    console.log("🚀 Reddit RSS Engine Started");
    checkSaved(bot);
    setInterval(() => checkSaved(bot), 2 * 60 * 1000); 
};

module.exports = { init };
