const downloader = require('../utils/downloader');

class MusicService {
    async extract(url) {
        try {
            console.log(`🎧 Music Service: ${url}`);
            
            // yt-dlp handles Spotify/SoundCloud metadata
            const info = await downloader.getInfo(url);

            return {
                type: 'audio',
                title: info.title || 'Music Track',
                source: url,
                cover: info.thumbnail, // Album Art
                formats: [] // We force audio download anyway
            };

        } catch (e) {
            console.error("Music Error:", e.message);
            return null;
        }
    }
}

module.exports = new MusicService();