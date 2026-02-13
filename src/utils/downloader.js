const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config/settings');

const execPromise = util.promisify(exec);

class Downloader {
    async execute(args) {
        let cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist ${args} --user-agent "${config.UA_ANDROID}"`;
        
        // Root-e cookies.txt thakle auto use korbe
        if (fs.existsSync(config.COOKIE_PATH)) {
            cmd += ` --cookies "${config.COOKIE_PATH}"`;
        }
        return await execPromise(cmd);
    }

    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            return JSON.parse(stdout);
        } catch (e) { throw new Error(`Info fetch failed: ${e.message}`); }
    }

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

    // FFmpeg use kore 50MB chunk-e split korar function
    async splitFile(inputPath) {
        if (!fs.existsSync(inputPath)) return [];
        
        const dir = path.dirname(inputPath);
        const fileName = path.basename(inputPath, path.extname(inputPath));
        const outputPattern = path.join(dir, `${fileName}_part%03d.mp4`);

        // Segment video into 48MB parts (approx)
        const cmd = `ffmpeg -i "${inputPath}" -c copy -map 0 -segment_time 00:03:00 -f segment "${outputPattern}"`;
        
        try {
            await execPromise(cmd);
            const files = fs.readdirSync(dir);
            const parts = files
                .filter(f => f.startsWith(fileName + '_part') && f.endsWith('.mp4'))
                .map(f => path.join(dir, f))
                .sort();
            return parts;
        } catch (e) {
            console.error("Split Error:", e);
            return [inputPath];
        }
    }

    async downloadFile(url, outputPath) {
        const writer = fs.createWriteStream(outputPath);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: { 'User-Agent': config.UA_ANDROID }
        });
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
}

module.exports = new Downloader();
