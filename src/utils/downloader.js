const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');

const execPromise = util.promisify(exec);

class Downloader {
    /**
     * yt-dlp কমান্ড এক্সিকিউট করার মূল ফাংশন
     * @param {string} args - yt-dlp এর আর্গুমেন্টসমূহ
     */
    async execute(args) {
        // টুইটার ইমেজ এরর এড়াতে --ignore-errors যোগ করা হয়েছে
        let cmd = `yt-dlp --force-ipv4 --no-check-certificate --no-warnings --ignore-errors --no-playlist ${args} --user-agent "${config.UA_ANDROID}"`;
        
        // কুকি ফাইল থাকলে সেটি কমান্ডে যুক্ত করবে
        if (fs.existsSync(config.COOKIE_PATH)) {
            cmd += ` --cookies "${config.COOKIE_PATH}"`;
        }
        
        return await execPromise(cmd);
    }

    /**
     * মিডিয়া ইউআরএল থেকে মেটাডাটা সংগ্রহ করা
     * @param {string} url - মিডিয়া লিঙ্ক
     */
    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            const info = JSON.parse(stdout);
            
            // টুইটার ইমেজের ক্ষেত্রে যদি ভিডিও স্ট্রিম না থাকে তবে থাম্বনেইলকে ইউআরএল হিসেবে সেট করবে
            if (url.includes('twitter.com') || url.includes('x.com')) {
                const isVideo = info.vcodec && info.vcodec !== 'none';
                if (!isVideo && info.thumbnails && info.thumbnails.length > 0) {
                    info.is_image = true;
                    info.url = info.thumbnails[info.thumbnails.length - 1].url;
                }
            }
            return info;
        } catch (e) { 
            console.error("yt-dlp Info Error:", e.message);
            throw new Error(`Media info fetch failed: ${e.message}`); 
        }
    }

    /**
     * ভিডিও বা অডিও ডাউনলোড করা
     */
    async download(url, isAudio, formatId, outputPath) {
        let typeArg = "";
        if (isAudio) {
            typeArg = `-x --audio-format mp3 -o "${outputPath}.%(ext)s"`;
        } else {
            const fmt = formatId === 'best' ? 'bestvideo+bestaudio/best' : `${formatId}+bestaudio/best`;
            // ভিডিও না পাওয়া গেলে ইমেজ বা ডিফল্ট ফরমেটে ফিরে যাওয়ার জন্য --fallback লজিক
            typeArg = `-f "${fmt}" --merge-output-format mp4 --fallback -o "${outputPath}.%(ext)s"`;
        }
        await this.execute(`${typeArg} "${url}"`);
    }

    /**
     * ৫০এমবি-র বেশি ফাইলকে ৩ মিনিটের সেগমেন্টে ভাগ করা
     * @param {string} inputPath - মূল ফাইলের পাথ
     */
    async splitFile(inputPath) {
        if (!fs.existsSync(inputPath)) return [inputPath];
        
        const stats = fs.statSync(inputPath);
        // যদি ফাইলটি ৪৯এমবি-র ছোট হয় তবে স্প্লিট করবে না
        if (stats.size <= 49 * 1024 * 1024) return [inputPath];

        const dir = path.dirname(inputPath);
        const fileName = path.basename(inputPath, path.extname(inputPath));
        const outputPattern = path.join(dir, `${fileName}_part%03d.mp4`);

        // FFmpeg segment logic ব্যবহার করে স্প্লিটিং
        const cmd = `ffmpeg -i "${inputPath}" -c copy -map 0 -segment_time 00:03:00 -f segment "${outputPattern}"`;
        
        try {
            await execPromise(cmd);
            const files = fs.readdirSync(dir);
            const parts = files
                .filter(f => f.startsWith(fileName + '_part') && f.endsWith('.mp4'))
                .map(f => path.join(dir, f))
                .sort();
            
            return parts.length > 0 ? parts : [inputPath];
        } catch (e) {
            console.error("Split Error:", e);
            return [inputPath];
        }
    }
}

module.exports = new Downloader();
