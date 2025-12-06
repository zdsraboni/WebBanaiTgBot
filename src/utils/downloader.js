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

    initCookies() {
        if (process.env.REDDIT_COOKIES) {
            let rawData = process.env.REDDIT_COOKIES;
            rawData = rawData.replace(/\\n/g, '\n').replace(/ /g, '\t').replace(/#HttpOnly_/g, '');
            if (!rawData.startsWith('# Netscape')) rawData = "# Netscape HTTP Cookie File\n" + rawData;
            fs.writeFileSync(config.COOKIE_PATH, rawData);
            console.log("✅ Cookies loaded.");
        }
    }

    async execute(args) {
        let cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist ${args} --user-agent "${config.UA_ANDROID}"`;
        if (fs.existsSync(config.COOKIE_PATH)) cmd += ` --cookies "${config.COOKIE_PATH}"`;
        return await execPromise(cmd);
    }

    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            return JSON.parse(stdout);
        } catch (e) { throw new Error(`Info fetch failed: ${e.message}`); }
    }

    // Main Download Function (Video/Audio)
    async download(url, isAudio, formatId, outputPath) {
        let typeArg = "";
        if (isAudio) typeArg = `-x --audio-format mp3 -o "${outputPath}.%(ext)s"`;
        else {
            const fmt = formatId === 'best' ? 'best' : `${formatId}+bestaudio/best`;
            typeArg = `-f "${fmt}" --merge-output-format mp4 -o "${outputPath}.%(ext)s"`;
        }
        await this.execute(`${typeArg} "${url}"`);
    }

    // NEW: Simple File Downloader (For Images)
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