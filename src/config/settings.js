require('dotenv').config();
const path = require('path');

module.exports = {
    // API & Server Keys
    BOT_TOKEN: process.env.BOT_TOKEN,
    APP_URL: process.env.RENDER_EXTERNAL_URL,
    PORT: process.env.PORT || 3000,
    
    // File System Paths
    DOWNLOAD_DIR: path.join(__dirname, '../../downloads'),
    COOKIE_PATH: path.join(__dirname, '../../cookies.txt'),
    
    // Android User-Agent (Critical for Reddit 403 Bypass)
    UA_ANDROID: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    
    // Global Regex
    URL_REGEX: /(https?:\/\/(?:www\.|old\.|mobile\.)?(?:reddit\.com|x\.com|twitter\.com)\/[^\s]+)/i,
    
    // Reddit Mirrors (For redundancy)
    REDDIT_MIRRORS: [
        'https://redlib.catsarch.com',
        'https://redlib.vlingit.com',
        'https://libreddit.kavin.rocks'
    ]
};
