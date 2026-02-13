const redditService = require('./reddit');
const twitterService = require('./twitter');
const tiktokService = require('./tiktok');
const instagramService = require('./instagram');

/**
 * Routes the URL to the appropriate service
 */
const extract = async (url) => {
    // Reddit
    if (url.includes('reddit.com') || url.includes('redd.it')) {
        return await redditService.extract(url);
    }
    
    // Twitter / X
    if (url.includes('twitter.com') || url.includes('x.com')) {
        return await twitterService.extract(url);
    }
    
    // TikTok
    if (url.includes('tiktok.com')) {
        return await tiktokService.extract(url);
    }
    
    // Instagram
    if (url.includes('instagram.com')) {
        return await instagramService.extract(url);
    }

    return null;
};

module.exports = { extract };
