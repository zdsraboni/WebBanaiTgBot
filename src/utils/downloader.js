const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');

const execPromise = util.promisify(exec);

class Downloader {
    async execute(args) {
        // --ignore-errors add kora hoyeche jate image thakle video search kore fail na kore
        let cmd = `yt-dlp --force-ipv4 --no-check-certificate --no-warnings --ignore-errors --no-playlist ${args} --user-agent "${config.UA_ANDROID}"`;
        
        if (fs.existsSync(config.COOKIE_PATH)) {
            cmd += ` --cookies "${config.COOKIE_PATH}"`;
        }
        return await execPromise(cmd);
    }

    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            const info = JSON.parse(stdout);
            
            // Twitter Image/Album logic
            if (!info.url && info.thumbnails && info.thumbnails.length > 0) {
                info.url = info.thumbnails[info.thumbnails.length - 1].url;
            }
            return info;
        } catch (e) { 
            console.error("yt-dlp Error:", e.message);
            throw new Error("Media info fetch failed."); 
        }
    }

    async download(url, isAudio, formatId, outputPath) {
        let typeArg = "";
        if (isAudio) {
            typeArg = `-x --audio-format mp3 -o "${outputPath}.%(ext)s"`;
        } else {
            const fmt = formatId === 'best' ? 'bestvideo+bestaudio/best' : `${formatId}+bestaudio/best`;
            // Image hole video format khujbe na
            typeArg = `-f "${fmt}" --merge-output-format mp4 --fallback -o "${outputPath}.%(ext)s"`;
        }
        await this.execute(`${typeArg} "${url}"`);
    }

    async splitFile(inputPath) {
        if (!fs.existsSync(inputPath)) return [inputPath];
        const stats = fs.statSync(inputPath);
        if (stats.size <= 49 * 1024 * 1024) return [inputPath];

        const dir = path.dirname(inputPath);
        const fileName = path.basename(inputPath, path.extname(inputPath));
        const outputPattern = path.join(dir, `${fileName}_part%03d.mp4`);

        const cmd = `ffmpeg -i "${inputPath}" -c copy -map 0 -segment_time 00:03:00 -f segment "${outputPattern}"`;
        try {
            await execPromise(cmd);
            const files = fs.readdirSync(dir);
            const parts = files
                .filter(f => f.startsWith(fileName + '_part') && f.endsWith('.mp4'))
                .map(f => path.join(dir, f))
                .sort();
            return parts.length > 0 ? parts : [inputPath];
        } catch (e) { return [inputPath]; }
    }
}

module.exports = new Downloader();
