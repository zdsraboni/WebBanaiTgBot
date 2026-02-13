require('dotenv').config();
const path = require('path');

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    APP_URL: process.env.RAILWAY_PUBLIC_DOMAIN 
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
        : (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL),
    PORT: process.env.PORT || 3000,
    ADMIN_ID: process.env.ADMIN_ID || 123456789,
    MONGO_URI: process.env.MONGO_URI, 
    DOWNLOAD_DIR: path.resolve(process.cwd(), 'downloads'),
    COOKIE_PATH: path.resolve(process.cwd(), 'cookies.txt'),
    UA_ANDROID: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    URL_REGEX: /(https?:\/\/(?:www\.|old\.|mobile\.|m\.)?(?:reddit\.com|redd\.it|x\.com|twitter\.com|instagram\.com|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\/[^\s]+)/i,
    REDDIT_MIRRORS: ['https://redlib.catsarch.com', 'https://redlib.vlingit.com']
};
