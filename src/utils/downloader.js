const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const axios = require('axios'); // ইমেজ ডাউনলোডের জন্য প্রয়োজনীয়
const config = require('../config/settings');

const execPromise = util.promisify(exec);

class Downloader {
    constructor() {
        this.initCookies();
    }

    // Render Environment থেকে কুকি লোড এবং রিপেয়ার করা
    initCookies() {
        if (process.env.REDDIT_COOKIES) {
            let rawData = process.env.REDDIT_COOKIES;
            // Render দ্বারা ভেঙে যাওয়া নিউলাইন ঠিক করা
            rawData = rawData.replace(/\\n/g, '\n').replace(/ /g, '\t').replace(/#HttpOnly_/g, '');
            
            // হেডার না থাকলে যোগ করা
            if (!rawData.startsWith('# Netscape')) {
                rawData = "# Netscape HTTP Cookie File\n" + rawData;
            }
            
            fs.writeFileSync(config.COOKIE_PATH, rawData);
            console.log("✅ Cookies loaded successfully.");
        }
    }

    // yt-dlp কমান্ড রান করার হেল্পার ফাংশন
    async execute(args) {
        let cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist ${args}`;
        
        // সব কমান্ডের জন্য User-Agent ফোর্স করা
        cmd += ` --user-agent "${config.UA_ANDROID}"`;
        
        // কুকি ফাইল থাকলে তা ব্যবহার করা
        if (fs.existsSync(config.COOKIE_PATH)) {
            cmd += ` --cookies "${config.COOKIE_PATH}"`;
        }
        return await execPromise(cmd);
    }

    // রেজোলিউশন লিস্ট (JSON মেটাডেটা) সংগ্রহ করা
    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            return JSON.parse(stdout);
        } catch (e) {
            throw new Error(`Info fetch failed: ${e.message}`);
        }
    }

    /**
     * মিডিয়া ফাইল ডাউনলোড করার মূল ফাংশন
     * @param {string} url - মিডিয়া ইউআরএল
     * @param {string} type - 'image', 'audio', অথবা 'video'
     * @param {string} formatId - ভিডিও ফরম্যাট আইডি (ইমেজের জন্য 'best' বা null দিতে পারেন)
     * @param {string} outputPath - ফাইল সেভ করার পাথ (এক্সটেনশন ছাড়া)
     */
    async download(url, type, formatId, outputPath) {
        // ১. ইমেজ ডাউনলোডের লজিক (নতুন যুক্ত করা হয়েছে)
        if (type === 'image') {
            try {
                const response = await axios({
                    url: url,
                    method: 'GET',
                    responseType: 'stream',
                    headers: {
                        'User-Agent': config.UA_ANDROID
                    }
                });

                const writer = fs.createWriteStream(`${outputPath}.jpg`);
                response.data.pipe(writer);

                return new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
            } catch (error) {
                throw new Error(`Image Download Failed: ${error.message}`);
            }
        }

        // ২. অডিও ডাউনলোডের লজিক
        if (type === 'audio') {
            const typeArg = `-x --audio-format mp3 -o "${outputPath}.%(ext)s"`;
            await this.execute(`${typeArg} "${url}"`);
            return;
        }

        // ৩. ভিডিও ডাউনলোডের লজিক
        // যদি 'best' রিকোয়েস্ট করা হয়, তবে yt-dlp কে সিদ্ধান্ত নিতে দিন
        // অন্যথায় নির্দিষ্ট ফরম্যাট + বেস্ট অডিও মার্জ করুন
        const fmt = formatId === 'best' ? 'best' : `${formatId}+bestaudio/best`;
        const typeArg = `-f "${fmt}" --merge-output-format mp4 -o "${outputPath}.%(ext)s"`;
        
        await this.execute(`${typeArg} "${url}"`);
    }
}

module.exports = new Downloader();
