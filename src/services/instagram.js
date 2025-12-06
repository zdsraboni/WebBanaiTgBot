const downloader = require('../utils/downloader');

class InstagramService {
    async extract(url) {
        try {
            console.log(`📸 Instagram Service: ${url}`);
            const info = await downloader.getInfo(url);

            const result = {
                title: info.title || 'Instagram Media',
                source: url,
                formats: info.formats || []
            };

            // Detect Type
            if (info.url) {
                // Direct Video URL found
                result.type = 'video';
                result.url = info.url;
            } else if (info.thumbnails && info.thumbnails.length > 0) {
                // Fallback for images
                result.type = 'image';
                result.url = info.thumbnails[info.thumbnails.length - 1].url;
            } else {
                // Default to video if unsure (yt-dlp usually handles it)
                result.type = 'video';
                result.url = url;
            }

            return result;

        } catch (e) {
            console.error("Instagram Error:", e.message);
            return null;
        }
    }
}

module.exports = new InstagramService();