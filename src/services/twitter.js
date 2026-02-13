const axios = require('axios');
const downloader = require('../utils/downloader');

class TwitterService {
    async extract(url) {
        try {
            // 1. Use FxTwitter API for Metadata
            const apiUrl = url.replace(/(twitter\.com|x\.com)/, 'api.fxtwitter.com');
            const { data } = await axios.get(apiUrl, { timeout: 5000 });
            const tweet = data.tweet;

            if (!tweet || !tweet.media) return null;

            const baseInfo = {
                title: tweet.text || 'Twitter Media',
                source: url,
                type: 'video' // default
            };

            // A. Gallery
            if (tweet.media.all && tweet.media.all.length > 1) {
                return {
                    ...baseInfo,
                    type: 'gallery',
                    items: tweet.media.all.map(m => ({ 
                        type: m.type === 'video' ? 'video' : 'image', 
                        url: m.url 
                    }))
                };
            }

            // B. Single Image
            if (tweet.media.photos && tweet.media.photos.length > 0) {
                return { ...baseInfo, type: 'image', url: tweet.media.photos[0].url };
            }

            // C. Single Video (With Fail-Safe)
            if (tweet.media.videos && tweet.media.videos.length > 0) {
                const videoData = {
                    ...baseInfo,
                    type: 'video',
                    url: tweet.media.videos[0].url // Direct MP4 link from API
                };

                // Try to get Qualities via yt-dlp
                try {
                    const info = await downloader.getInfo(url);
                    videoData.formats = info.formats; // Success: User gets resolution options
                } catch (e) {
                    console.log("⚠️ Twitter Quality Check Failed. Falling back to Direct Link Mode.");
                    // Fail-safe: We return videoData WITHOUT 'formats'.
                    // The bot will see this and show the "Download Video" fallback button.
                }
                return videoData;
            }
        } catch (e) {
            console.error("Twitter Service Error:", e.message);
            return null;
        }
    }
}

module.exports = new TwitterService();
