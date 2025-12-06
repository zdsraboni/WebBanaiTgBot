const axios = require('axios');
const config = require('../config/settings');

class RedditService {
    async extract(url) {
        let pathName = "";
        try { pathName = new URL(url).pathname; } catch(e) { return null; }

        // STRATEGY 1: DIRECT API
        try {
            const cleanUrl = url.split('?')[0];
            const jsonUrl = cleanUrl.replace(/\/$/, '') + '.json';
            const { data } = await axios.get(jsonUrl, {
                timeout: 5000,
                headers: { 'User-Agent': config.UA_ANDROID }
            });

            if (data && data[0] && data[0].data) {
                return this.parseRedditData(data[0].data.children[0].data, url);
            }
        } catch (e) {}

        // STRATEGY 2: MIRRORS
        for (const domain of config.REDDIT_MIRRORS) {
            try {
                let mirrorUrl = `${domain}${pathName}`.replace(/\/+/g, '/').replace('https:/', 'https://'); 
                if (!mirrorUrl.endsWith('.json')) mirrorUrl += ".json";
                
                const { data } = await axios.get(mirrorUrl, {
                    timeout: 6000,
                    headers: { 'User-Agent': config.UA_ANDROID }
                });

                if (data && data[0] && data[0].data) {
                    return this.parseRedditData(data[0].data.children[0].data, url);
                }
            } catch (e) { continue; } 
        }

        // STRATEGY 3: FALLBACK
        return {
            title: 'Reddit Media (Fallback)',
            author: 'Reddit User', // Fallback Author
            source: url,
            type: 'video',
            url: url
        };
    }

    parseRedditData(post, sourceUrl) {
        // CAPTURE AUTHOR HERE
        const baseInfo = { 
            title: post.title || 'Reddit Media', 
            author: post.author ? `u/${post.author}` : 'Reddit User',
            source: sourceUrl 
        };

        if (post.is_gallery && post.media_metadata) {
            const items = [];
            const ids = post.gallery_data?.items || [];
            ids.forEach(item => {
                const meta = post.media_metadata[item.media_id];
                if (meta && meta.status === 'valid') {
                    let u = meta.s.u ? meta.s.u.replace(/&amp;/g, '&') : meta.s.gif;
                    if (meta.e === 'Video' && meta.s.mp4) {
                        u = meta.s.mp4.replace(/&amp;/g, '&');
                    }
                    items.push({ type: 'image', url: u });
                }
            });
            return { ...baseInfo, type: 'gallery', items };
        }

        if (post.secure_media && post.secure_media.reddit_video) {
            return {
                ...baseInfo,
                type: 'video',
                url: post.secure_media.reddit_video.fallback_url.split('?')[0]
            };
        }

        if (post.url && (post.url.match(/\.(jpeg|jpg|png|gif)$/i) || post.post_hint === 'image')) {
            return { ...baseInfo, type: 'image', url: post.url };
        }

        if (post.url) {
            return { ...baseInfo, type: 'video', url: post.url };
        }

        return null;
    }
}

module.exports = new RedditService();