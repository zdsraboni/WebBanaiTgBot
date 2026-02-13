const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config/settings');

const execPromise = util.promisify(exec);

class Downloader {
    async execute(args) {
        let cmd = `yt-dlp --force-ipv4 --no-check-certificate --no-warnings --ignore-errors --no-playlist ${args} --user-agent "${config.UA_ANDROID}"`;
        if (fs.existsSync(config.COOKIE_PATH)) {
            cmd += ` --cookies "${config.COOKIE_PATH}"`;
        }
        return await execPromise(cmd);
    }

    async getInfo(url) {
        try {
            const { stdout } = await this.execute(`-J "${url}"`);
            if (!stdout) throw new Error("No metadata found");
            const info = JSON.parse(stdout);
            
            // Image vs Video detection
            const isVideo = (info.vcodec && info.vcodec !== 'none') || info.ext === 'gif' || info.protocol === 'm3u8_native';
            
            if (!isVideo && info.thumbnails && info.thumbnails.length > 0) {
                info.is_image = true;
                info.url = info.thumbnails[info.thumbnails.length - 1].url;
            }
            return info;
        } catch (e) { 
            // FIXED: Prevent double "vx" prefix
            let vxUrl = url;
            if (!vxUrl.includes('vxtwitter.com')) {
                vxUrl = vxUrl.includes('x.com') ? vxUrl.replace('x.com', 'vxtwitter.com') : vxUrl.replace('twitter.com', 'vxtwitter.com');
            }
            return { is_image: true, url: vxUrl, title: 'Twitter Media' };
        }
    }

    async downloadGeneric(url, outputPath) {
        const response = await axios({ method: 'get', url: url, responseType: 'stream' });
        const writer = fs.createWriteStream(outputPath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    async download(url, isAudio, formatId, outputPath) {
        let typeArg = isAudio ? `-x --audio-format mp3` : `-f "bestvideo+bestaudio/best" --merge-output-format mp4 --fallback`;
        await this.execute(`${typeArg} -o "${outputPath}.%(ext)s" "${url}"`);
    }

    async splitFile(inputPath) {
        if (!fs.existsSync(inputPath)) return [inputPath];
        const dir = path.dirname(inputPath);
        const fileName = path.basename(inputPath, path.extname(inputPath));
        const outputPattern = path.join(dir, `${fileName}_part%03d.mp4`);
        await execPromise(`ffmpeg -i "${inputPath}" -c copy -map 0 -segment_time 00:03:00 -f segment "${outputPattern}"`);
        return fs.readdirSync(dir).filter(f => f.startsWith(fileName + '_part')).map(f => path.join(dir, f)).sort();
    }
}

module.exports = new Downloader();
