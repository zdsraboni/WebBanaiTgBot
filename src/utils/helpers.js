const axios = require('axios');
const config = require('../config/settings');

const resolveRedirect = async (url) => {
    // Skip TikTok short links
    if (!url.includes('/s/') && !url.includes('vm.tiktok') && !url.includes('vt.tiktok')) return url;
    
    try {
        const res = await axios.head(url, {
            maxRedirects: 0,
            validateStatus: s => s >= 300 && s < 400,
            headers: { 'User-Agent': config.UA_ANDROID }
        });
        return res.headers.location || url;
    } catch (e) { return url; }
};

// NEW: File Size Formatter
const formatBytes = (bytes, decimals = 2) => {
    if (!bytes || bytes === 0) return 'N/A';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

module.exports = { resolveRedirect, formatBytes };