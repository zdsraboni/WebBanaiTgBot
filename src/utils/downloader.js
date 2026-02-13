const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const axios = require('axios');
const config = require('../config/settings');

const execPromise = util.promisify(exec);

class Downloader {
    constructor() {
        this.initCookies();
    }

    // কুকি রিপেয়ারিং (আগের মতোই)
    initCookies() {
        if (process.env.REDDIT_COOKIES) {
            let rawData = process.env.REDDIT_COOKIES;
            rawData = rawData.replace(/\\n/g, '\n').replace(/ /g, '\t').replace(/#HttpOnly_/g, '');
            if (!rawData.startsWith('# Netscape')) rawData = "# Netscape HTTP Cookie File\n" + rawData;
            fs.writeFileSync(config.COOKIE_PATH, rawData);
            console.log("✅ Cookies loaded.");
        }
    }

    // yt-dlp হেল্পার
    async execute(args) {
        let cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist ${args} --user-agent "${config.UA_ANDROID}"`;
        if (fs.existsSync(config.COOKIE_PATH)) cmd += ` --cookies "${config.COOKIE_PATH}"`;
        return await execPromise(cmd);
    }

    // মেটাডেটা সংগ্রহ
    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            return JSON.parse(stdout);
        } catch (e) { throw new Error(`Info fetch failed: ${e.message}`); }
    }

    // অডিও এবং ভিডিওর জন্য (yt-dlp)
    async download(url, isAudio, formatId, outputPath) {
        let typeArg = "";
        if (isAudio) {
            typeArg = `-x --audio-format mp3 -o "${outputPath}.%(ext)s"`;
        } else {
            const fmt = formatId === 'best' ? 'best' : `${formatId}+bestaudio/best`;
            typeArg = `-f "${fmt}" --merge-output-format mp4 -o "${outputPath}.%(ext)s"`;
        }
        await this.execute(`${typeArg} "${url}"`);
    }

    // ✅ ইমেজ ডাউনলোডের জন্য স্পেশাল ফাংশন (আপনার Working Version থেকে নেওয়া)
    // এটি handlers.js এর সাথে সিঙ্ক করা হয়েছে
    async downloadFile(url, outputPath) {
        try {
            const writer = fs.createWriteStream(outputPath);
            
            // ইন্সটাগ্রাম এবং টুইটার ব্লক ঠেকানোর জন্য হেডার্স
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                headers: { 
                    'User-Agent': config.UA_ANDROID || 'Mozilla/5.0',
                    'Referer': 'https://www.instagram.com/',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            });

            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        } catch (error) {
            throw new Error(`Image download failed: ${error.message}`);
        }
    }
}

module.exports = new Downloader();
