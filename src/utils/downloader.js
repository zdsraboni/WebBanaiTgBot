const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const config = require('../config/settings');

const execPromise = util.promisify(exec);

class Downloader {
    async execute(args) {
        // --no-check-certificate and --prefer-free-formats added for stability
        let cmd = `yt-dlp --force-ipv4 --no-check-certificate --no-warnings --no-playlist ${args} --user-agent "${config.UA_ANDROID}"`;
        
        // Cookies check directly from absolute path
        if (fs.existsSync(config.COOKIE_PATH)) {
            cmd += ` --cookies "${config.COOKIE_PATH}"`;
        }
        
        return await execPromise(cmd);
    }

    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            return JSON.parse(stdout);
        } catch (e) { 
            console.error("yt-dlp Info Error:", e.message);
            throw new Error(`Media not found or restricted. Check logs.`); 
        }
    }

    async download(url, isAudio, formatId, outputPath) {
        let typeArg = "";
        if (isAudio) {
            typeArg = `-x --audio-format mp3 -o "${outputPath}.%(ext)s"`;
        } else {
            const fmt = formatId === 'best' ? 'bestvideo+bestaudio/best' : `${formatId}+bestaudio/best`;
            typeArg = `-f "${fmt}" --merge-output-format mp4 -o "${outputPath}.%(ext)s"`;
        }
        await this.execute(`${typeArg} "${url}"`);
    }

    async splitFile(inputPath) {
        if (!fs.existsSync(inputPath)) return [inputPath];
        
        const stats = fs.statSync(inputPath);
        // If file is already smaller than 49MB, don't split
        if (stats.size <= 49 * 1024 * 1024) return [inputPath];

        const dir = path.dirname(inputPath);
        const fileName = path.basename(inputPath, path.extname(inputPath));
        const outputPattern = path.join(dir, `${fileName}_part%03d.mp4`);

        // FFmpeg splitting logic
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
