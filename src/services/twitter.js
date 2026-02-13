const axios = require('axios');
const downloader = require('../utils/downloader');

class TwitterService {
    /**
     * টুইটার বা এক্স (X) থেকে মিডিয়া তথ্য এক্সট্রাক্ট করার মূল ফাংশন
     * @param {string} url - টুইট ইউআরএল
     */
    async extract(url) {
        try {
            // ১. টুইটার ইউআরএলকে FxTwitter API ইউআরএলে রূপান্তর
            const apiUrl = url.replace(/(twitter\.com|x\.com)/, 'api.fxtwitter.com');
            
            // API থেকে ডেটা ফেচ করা (৫ সেকেন্ড টাইমআউট সহ)
            const { data } = await axios.get(apiUrl, { 
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const tweet = data.tweet;

            // যদি টুইটে কোনো মিডিয়া না থাকে
            if (!tweet || !tweet.media) {
                return null;
            }

            // অথরের নাম সংগ্রহ (বিভিন্ন API ভার্সন অনুযায়ী চেক করা)
            const authorName = tweet.author?.name || tweet.user?.name || 'Twitter User';

            // বেসিক ইনফরমেশন অবজেক্ট
            const baseInfo = {
                title: tweet.text || 'Twitter Media',
                author: authorName,
                source: url
            };

            // A. যদি একাধিক মিডিয়া (ইমেজ/ভিডিও) থাকে - গ্যালারি মোড
            if (tweet.media.all && tweet.media.all.length > 1) {
                return {
                    ...baseInfo,
                    type: 'gallery',
                    items: tweet.media.all.map(m => ({ 
                        type: m.type === 'video' || m.type === 'gif' ? 'video' : 'image', 
                        url: m.url 
                    }))
                };
            }

            // B. যদি শুধুমাত্র একটি ইমেজ থাকে
            if (tweet.media.photos && tweet.media.photos.length > 0) {
                return { 
                    ...baseInfo, 
                    type: 'image', 
                    url: tweet.media.photos[0].url 
                };
            }

            // C. যদি শুধুমাত্র একটি ভিডিও থাকে
            if (tweet.media.videos && tweet.media.videos.length > 0) {
                const videoData = {
                    ...baseInfo,
                    type: 'video',
                    url: tweet.media.videos[0].url 
                };

                try {
                    // ভিডিওর ক্ষেত্রে কোয়ালিটি বা ফরম্যাট চেক করার চেষ্টা
                    const info = await downloader.getInfo(url);
                    if (info && info.formats) {
                        videoData.formats = info.formats; 
                    }
                } catch (e) {
                    console.log("⚠️ Twitter Quality Check Failed. Falling back to Direct Link.");
                }
                return videoData;
            }

            return null;

        } catch (e) {
            console.error("Twitter Service Error:", e.message);
            return null;
        }
    }
}

// সার্ভিসটি এক্সপোর্ট করা হচ্ছে
module.exports = new TwitterService();
