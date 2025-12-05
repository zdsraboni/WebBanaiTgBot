const axios = require('axios');
const config = require('../config/settings');

class RedditService {
    async extract(url) {
        let pathName = "";
        try { pathName = new URL(url).pathname; } catch(e) { return null; }

        // ============================================================
        // STRATEGY 1: DIRECT REDDIT API (The v10 Method)
        // This usually works 99% of the time with the Android User-Agent
        // ============================================================
        try {
            const cleanUrl = url.split('?')[0];
            const jsonUrl = cleanUrl.replace(/\/$/, '') + '.json';
            
            console.log(`🕵️ Trying Direct Reddit API: ${jsonUrl}`);
            
            const { data } = await axios.get(jsonUrl, {
                timeout: 5000,
                headers: { 'User-Agent': config.UA_ANDROID }
            });

            if (data && data[0] && data[0].data) {
                console.log("✅ Direct API Success");
                return this.parseRedditData(data[0].data.children[0].data, url);
            }
        } catch (e) {
            console.log(`⚠️ Direct Reddit API failed (${e.message}). Switching to Mirrors...`);
        }

        // ============================================================
        // STRATEGY 2: MIRROR ROTATION (Backup)
        // If Reddit blocks the direct request, we ask the mirrors.
        // ============================================================
        for (const domain of config.REDDIT_MIRRORS) {
            try {
                // Construct Mirror API URL
                let mirrorUrl = `${domain}${pathName}`;
                // Clean up double slashes and ensure .json
                mirrorUrl = mirrorUrl.replace(/\/+/g, '/').replace('https:/', 'https://'); 
                if (!mirrorUrl.endsWith('.json')) mirrorUrl += ".json";

                console.log(`🌐 Trying Mirror: ${domain}`);
                
                const { data } = await axios.get(mirrorUrl, {
                    timeout: 6000,
                    headers: { 'User-Agent': config.UA_ANDROID }
                });

                if (data && data[0] && data[0].data) {
                    console.log(`✅ Mirror Success on ${domain}`);
                    return this.parseRedditData(data[0].data.children[0].data, url);
                }

            } catch (e) { 
                console.log(`❌ Mirror ${domain} failed.`);
                continue; 
            } 
        }
        
        console.error("❌ All strategies failed.");
        return null;
    }

    // Helper to process the JSON data (Shared by both strategies)
    parseRedditData(post, sourceUrl) {
        const baseInfo = { title: post.title || 'Reddit Media', source: sourceUrl };

        // A. Gallery
        if (post.is_gallery && post.media_metadata) {
            const items = [];
            const ids = post.gallery_data?.items || [];
            ids.forEach(item => {
                const meta = post.media_metadata[item.media_id];
                if (meta && meta.status === 'valid') {
                    // Try to get highest quality image
                    let u = meta.s.u ? meta.s.u.replace(/&amp;/g, '&') : meta.s.gif;
                    // Sometimes galleries contain videos (MP4)
                    if (meta.e === 'Video' && meta.s.mp4) {
                        u = meta.s.mp4.replace(/&amp;/g, '&');
                        items.push({ type: 'video', url: u });
                    } else {
                        items.push({ type: 'image', url: u });
                    }
                }
            });
            return { ...baseInfo, type: 'gallery', items };
        }

        // B. Video (Extract Direct Link)
        if (post.secure_media && post.secure_media.reddit_video) {
            return {
                ...baseInfo,
                type: 'video',
                // Direct HLS/MP4 link bypasses the 403 block on the main site
                url: post.secure_media.reddit_video.fallback_url.split('?')[0]
            };
        }

        // C. Image / GIF
        if (post.url && (post.url.match(/\.(jpeg|jpg|png|gif)$/i) || post.post_hint === 'image')) {
            return { ...baseInfo, type: 'image', url: post.url };
        }

        return null;
    }
}

module.exports = new RedditService();
