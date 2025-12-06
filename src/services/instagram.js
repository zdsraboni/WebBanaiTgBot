const downloader = require('../utils/downloader');

class InstagramService {
    async extract(url) {
        try {
            console.log(`📸 Instagram Service: ${url}`);
            const info = await downloader.getInfo(url);

            const baseInfo = {
                title: info.title || 'Instagram Media',
                source: url,
                formats: info.formats || []
            };

            // 1. Carousel / Gallery (Multiple Images/Videos)
            if (info._type === 'playlist' && info.entries) {
                const items = info.entries.map(entry => ({
                    type: entry.ext === 'mp4' ? 'video' : 'image',
                    url: entry.url
                }));
                return { ...baseInfo, type: 'gallery', items };
            }

            // 2. Single Video
            if (info.ext === 'mp4' || info.url?.includes('.mp4')) {
                return {
                    ...baseInfo,
                    type: 'video',
                    url: info.url // Direct Video Link
                };
            }

            // 3. Single Image
            // yt-dlp puts the image link in 'url' for simple posts
            return {
                ...baseInfo,
                type: 'image',
                url: info.url
            };

        } catch (e) {
            console.error("Instagram Error:", e.message);
            return null;
        }
    }
}

module.exports = new InstagramService();