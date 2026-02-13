const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const config = require('../config/settings');

const execPromise = util.promisify(exec);

class Downloader {
    constructor() {
        this.initCookies();
    }

    // Load and repair cookies from Render Environment
    initCookies() {
        if (process.env.REDDIT_COOKIES) {
            let rawData = process.env.REDDIT_COOKIES;
            // Repair newlines broken by Render
            rawData = rawData.replace(/\\n/g, '\n').replace(/ /g, '\t').replace(/#HttpOnly_/g, '');
            
            // Add header if missing
            if (!rawData.startsWith('# Netscape')) {
                rawData = "# Netscape HTTP Cookie File\n" + rawData;
            }
            
            fs.writeFileSync(config.COOKIE_PATH, rawData);
            console.log("✅ Cookies loaded successfully.");
        }
    }

    // Helper to run yt-dlp commands
    async execute(args) {
        let cmd = `yt-dlp --force-ipv4 --no-warnings --no-playlist ${args}`;
        
        // Force User-Agent for all commands
        cmd += ` --user-agent "${config.UA_ANDROID}"`;
        
        // Use Cookies if they exist
        if (fs.existsSync(config.COOKIE_PATH)) {
            cmd += ` --cookies "${config.COOKIE_PATH}"`;
        }
        return await execPromise(cmd);
    }

    // Get Resolution List (JSON Metadata)
    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            return JSON.parse(stdout);
        } catch (e) {
            throw new Error(`Info fetch failed: ${e.message}`);
        }
    }

    // Download File
    async download(url, isAudio, formatId, outputPath) {
        let typeArg = "";
        
        if (isAudio) {
            typeArg = `-x --audio-format mp3 -o "${outputPath}.%(ext)s"`;
        } else {
            // If 'best' is requested (fallback mode), let yt-dlp decide
            // Otherwise use specific format + best audio
            const fmt = formatId === 'best' ? 'best' : `${formatId}+bestaudio/best`;
            typeArg = `-f "${fmt}" --merge-output-format mp4 -o "${outputPath}.%(ext)s"`;
        }
        
        await this.execute(`${typeArg} "${url}"`);
    }
}

module.exports = new Downloader();
