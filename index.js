const http = require("http");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const ytDlp = require("yt-dlp-exec");
const ffmpegPath = require("ffmpeg-static");
const FormData = require("form-data");

const TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

// Send text message
async function sendMessage(chatId, text) {
    await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
    });
}

// Send file to Telegram
async function sendDocument(chatId, filePath) {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", fs.createReadStream(filePath));

    await fetch(`${API}/sendDocument`, {
        method: "POST",
        body: form
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", async () => {
            try {
                const update = JSON.parse(body);
                if (update.message) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text;

                    // Commands
                    if (text === "/start") {
                        await sendMessage(chatId, "👋 Welcome! Send /help to see commands.");
                    } else if (text === "/help") {
                        await sendMessage(chatId, "Commands:\n/start - Welcome message\n/help - List commands\n/download <URL> - Download media\n/ping - Test bot");
                    } else if (text.startsWith("/ping")) {
                        await sendMessage(chatId, "🏓 Pong! Bot is alive.");
                    } else if (text.startsWith("/download ")) {
                        const url = text.replace("/download ", "").trim();
                        if (!url) {
                            await sendMessage(chatId, "❌ Please provide a URL after /download");
                        } else {
                            await sendMessage(chatId, "⏳ Processing your download, please wait...");

                            const tmpFile = path.join("/tmp", `media_${Date.now()}.mp4`);

                            try {
                                // Download using yt-dlp-exec with corrected options
                                await ytDlp(url, {
                                    output: tmpFile,
                                    ffmpegLocation: ffmpegPath,
                                    // Browser-like headers to avoid blocks
                                    "add-header": [
                                        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
                                        "Accept-Language: en-US,en;q=0.9"
                                    ],
                                    ignoreErrors: true,        // Continue on minor extraction errors
                                    noCheckCertificates: true, // Ignore SSL certificate issues
                                    extractFlat: false,
                                    preferFreeFormats: true
                                });

                                // Check if file exists
                                if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 0) {
                                    await sendDocument(chatId, tmpFile);
                                    await sendMessage(chatId, "✅ Download complete and sent to you!");
                                    fs.unlink(tmpFile, () => {});
                                } else {
                                    await sendMessage(chatId, "❌ Unable to download media. It may be restricted, private, or unsupported.");
                                }

                            } catch (err) {
                                console.error("Download/send error:", err);
                                await sendMessage(chatId, `❌ Error downloading or sending media:\n${err.message}`);
                            }
                        }
                    } else {
                        await sendMessage(chatId, "❌ Unknown command or URL. Use /help to see commands.");
                    }
                }
            } catch (e) {
                console.error("Error processing update:", e);
            }
            res.writeHead(200);
            res.end("OK");
        });
    } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Bot is alive");
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Bot server running on port ${PORT}`);
});
