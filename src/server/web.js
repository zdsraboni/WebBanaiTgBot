const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 

const setupServer = (bot) => {
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/api/logs', (req, res) => res.json(logger.getLogs()));

    // 2. AUTOMATION WEBHOOK
    app.all('/api/trigger', async (req, res) => {
        const query = req.query;
        const body = req.body;
        const secret = query.secret || body.secret;
        const url = query.url || body.url;

        if (String(secret) !== String(config.ADMIN_ID)) return res.status(403).send('❌ Access Denied');
        if (!url) return res.status(400).send('❌ No URL');

        // ✅ Respond OK immediately (IFTTT stops waiting)
        res.status(200).send('✅ Link Received. Check Telegram.');

        try {
            const userId = config.ADMIN_ID; 
            console.log(`🤖 Auto-Link: ${url}`);

            // Mock Context: Pretend you sent the message
            const mockCtx = {
                from: { id: userId, first_name: 'Admin', is_bot: false },
                chat: { id: userId, type: 'private' },
                message: { text: url, message_id: 0, from: { id: userId } },
                reply: (text, extra) => bot.telegram.sendMessage(userId, text, extra),
                telegram: bot.telegram,
                answerCbQuery: () => Promise.resolve(),
                replyWithVideo: (v, e) => bot.telegram.sendVideo(userId, v, e),
                replyWithAudio: (a, e) => bot.telegram.sendAudio(userId, a, e),
                replyWithPhoto: (p, e) => bot.telegram.sendPhoto(userId, p, e),
                replyWithDocument: (d, e) => bot.telegram.sendDocument(userId, d, e),
            };

            // ✅ Pass to Main Handler -> It will show BUTTONS now (Not auto-download)
            await handlers.handleMessage(mockCtx);

        } catch (e) {
            console.error("Webhook Error:", e);
        }
    });

    app.get('/', (req, res) => res.send(`Media Banai Bot Online`));

    const keepAlive = () => { if (config.APP_URL) axios.get(`${config.APP_URL}/api/logs`).catch(()=>{}); };
    setInterval(keepAlive, 600000);

    if (process.env.NODE_ENV === 'production') {
        app.use(bot.webhookCallback('/bot'));
        bot.telegram.setWebhook(`${config.APP_URL}/bot`);
        app.listen(config.PORT, '0.0.0.0', () => console.log(`🚀 Server listening on port ${config.PORT}`));
        setTimeout(keepAlive, 60000); 
    } else {
        bot.launch();
    }
};

module.exports = { setupServer };
