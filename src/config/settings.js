require('dotenv').config();
const path = require('path');

module.exports = {
    // ১. API & Server Keys
    BOT_TOKEN: process.env.BOT_TOKEN,
    
    // রেলওয়ে এবং রেন্ডার উভয় প্ল্যাটফর্মের জন্য অটোমেটিক URL ডিটেকশন
    APP_URL: process.env.RAILWAY_PUBLIC_DOMAIN 
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
        : (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL),

    // রেলওয়ে পোর্ট (ডিফল্ট ৩০০০)
    PORT: process.env.PORT || 3000,
    
    // এডমিন এবং ডাটাবেস
    ADMIN_ID: process.env.ADMIN_ID || 123456789,
    MONGO_URI: process.env.MONGO_URI, 

    // ২. ফাইল সিস্টেম পাথ (Absolute Path ব্যবহার করা হয়েছে রেলওয়ের জন্য)
    DOWNLOAD_DIR: path.resolve(process.cwd(), 'downloads'),
    
    // সরাসরি রুট ফোল্ডারের cookies.txt ফাইলটি ব্যবহার করবে
    COOKIE_PATH: path.resolve(process.cwd(), 'cookies.txt'),

    // ৩. আইডেন্টিটি এবং ইউজার এজেন্ট
    UA_ANDROID: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',

    // ৪. আপডেটেড সোশ্যাল মিডিয়া রেজেক্স (Regex)
    URL_REGEX: /(https?:\/\/(?:www\.|old\.|mobile\.|m\.)?(?:reddit\.com|redd\.it|x\.com|twitter\.com|instagram\.com|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\/[^\s]+)/i,

    // ৫. রেডিট মিরর লিস্ট
    REDDIT_MIRRORS: [
        'https://redlib.catsarch.com',
        'https://redlib.vlingit.com',
        'https://libreddit.kavin.rocks',
        'https://redlib.tux.pizza'
    ]
};
