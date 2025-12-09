const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/settings');
const handlers = require('../utils/handlers'); 
const db = require('../utils/db'); // Import DB to check settings

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

        res.status(200).send('✅ Received');

        try {
            // ✅ FETCH DESTINATION FROM DB
            const userConfig = await db.getAdminConfig(config.ADMIN_ID);
            // Use Saved Target OR Default to Admin Private ID
            const targetId = userConfig?.twitterConfig?.webhookTarget || config.ADMIN_ID;

            console.log(`🤖 Auto-Link: ${url} -> Target: ${targetId}`);

            const mockCtx = {
                from: { id: config.ADMIN_ID, first_name: 'Admin' },
                chat: { id: targetId }, // Use Target ID here
                message: { text: url, message_id: 0, from: { id: config.ADMIN_ID } },
                
                reply: (text, extra) => bot.telegram.sendMessage(targetId, text, extra),
                telegram: bot.telegram,
                answerCbQuery: () => Promise.resolve(),
                replyWithVideo: (v, e) => bot.telegram.sendVideo(targetId, v, e),
                replyWithAudio: (a, e) => bot.telegram.sendAudio(targetId, a, e),
                replyWithPhoto: (p, e) => bot.telegram.sendPhoto(targetId, p, e),
                replyWithDocument: (d, e) => bot.telegram.sendDocument(targetId, d, e),
            };

            await handlers.handleMessage(mockCtx);

        } catch (e) {
            console.error("Webhook Error:", e);
        }
    });

    app.get('/', (req, res) => {
        res.send(`<!DOCTYPE html><html><body><h1>Media Banai Online</h1></body></html>`);
    });

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
