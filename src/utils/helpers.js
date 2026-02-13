// File: src/utils/helpers.js
const axios = require('axios');
const config = require('../config/settings');

const resolveRedirect = async (url) => {
    if (!url.includes('/s/')) return url;
    try {
        const res = await axios.head(url, {
            maxRedirects: 0,
            validateStatus: s => s >= 300 && s < 400,
            headers: { 'User-Agent': config.UA_ANDROID }
        });
        return res.headers.location || url;
    } catch (e) { return url; }
};

module.exports = { resolveRedirect };