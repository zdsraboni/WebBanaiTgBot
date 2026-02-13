const axios = require('axios');
const db = require('../utils/db');
const config = require('../config/settings');
const handlers = require('../utils/handlers');

const checkLikes = async (bot) => {
    const adminId = config.ADMIN_ID;
    const user = await db.getAdminConfig(adminId);

    // 1. Check Config
    if (!user || user.twitterConfig.mode !== 'api') {
        // console.log("💤 Poller: Sleeping (Webhook Mode)"); // Uncomment if you want spam
        return;
    }
    if (!user.twitterConfig.apiKey || !user.twitterConfig.targetHandle) {
        console.log("❌ Poller: Missing API Key or Handle.");
        return;
    }

    console.log(`🕵️ Poller: Checking @${user.twitterConfig.targetHandle}...`);

    try {
        // 2. Call API
        const response = await axios.get(`https://api.twitterapi.io/twitter/user/last_likes`, {
            params: { userName: user.twitterConfig.targetHandle },
            headers: { 'X-API-Key': user.twitterConfig.apiKey }
        });

        // 3. Validate Response
        // API often returns { tweets: [...] } OR { likes: [...] }
        const tweets = response.data.tweets || response.data.likes || [];
        
        if (!Array.isArray(tweets)) {
            console.log("⚠️ Poller: Unexpected API format:", response.data);
            return;
        }

        if (tweets.length === 0) {
            console.log("💤 Poller: No likes found (API returned empty list).");
            return;
        }

        // 4. Process Tweets
        const lastIdStr = user.twitterConfig.lastLikedId || "0";
        const lastId = BigInt(lastIdStr);
        
        // Sort Old -> New
        tweets.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? 1 : -1));
        const newestInBatch = tweets[tweets.length - 1].id;

        console.log(`📊 Poller: LastDB=${lastIdStr} | NewestAPI=${newestInBatch}`);

        // FIRST RUN CHECK
        if (lastId === 0n) {
            console.log(`✨ First Run Sync: Setting start point to ${newestInBatch}`);
            await db.updateLastId(adminId, newestInBatch);
            // Optional: Send test message to confirm connection
            await bot.telegram.sendMessage(adminId, `✅ <b>API Connected!</b>\nSynced with latest like ID: <code>${newestInBatch}</code>\nWaiting for NEW likes...`, { parse_mode: 'HTML' });
            return;
        }

        // FILTER NEW
        let newCount = 0;
        for (const tweet of tweets) {
            if (BigInt(tweet.id) > lastId) {
                newCount++;
                const tweetUrl = `https://twitter.com/${user.twitterConfig.targetHandle}/status/${tweet.id}`;
                console.log(`🔥 Sending New Like: ${tweetUrl}`);

                // Send to Bot
                const mockCtx = {
                    from: { id: adminId, first_name: 'Admin', is_bot: false },
                    chat: { id: adminId, type: 'private' },
                    message: { text: tweetUrl, message_id: 0, from: { id: adminId } },
                    reply: (text, extra) => bot.telegram.sendMessage(adminId, text, extra),
                    telegram: bot.telegram,
                    answerCbQuery: () => Promise.resolve(),
                    replyWithVideo: (v, e) => bot.telegram.sendVideo(adminId, v, e),
                    replyWithAudio: (a, e) => bot.telegram.sendAudio(adminId, a, e),
                    replyWithPhoto: (p, e) => bot.telegram.sendPhoto(adminId, p, e),
                    replyWithDocument: (d, e) => bot.telegram.sendDocument(adminId, d, e),
                };

                await handlers.handleMessage(mockCtx);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (newCount > 0) {
            console.log(`✅ Processed ${newCount} new tweets.`);
            await db.updateLastId(adminId, newestInBatch);
        } else {
            console.log("💤 No *new* tweets found since last check.");
        }

    } catch (e) {
        console.error("❌ Poller Error:", e.message);
        // If API Key is wrong/expired, warn user
        if (e.response && e.response.status === 401) {
            await bot.telegram.sendMessage(adminId, "⚠️ <b>API Error:</b> Unauthorized. Check your API Key.", { parse_mode: 'HTML' });
        }
    }
};

const init = (bot) => {
    console.log("🚀 Polling Engine Started");
    // Initial Check
    checkLikes(bot);
    // Loop
    setInterval(() => checkLikes(bot), 60 * 1000);
};

module.exports = { init };
