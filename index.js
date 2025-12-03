import http from "http";
import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import FormData from "form-data";

const TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

async function sendMessage(chatId, text) {
    await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
    });
}

// Send file to user
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

                    // COMMAND HANDLER
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

                            // Generate unique temporary file name
                            const fileName = `media_${Date.now()}.mp4`;

                            // Download using yt-dlp
                            exec(`yt-dlp -o ${fileName} ${url}`, async (error, stdout, stderr) => {
                                if (error) {
                                    console.error("Download error:", error.message);
                                    await sendMessage(chatId, `❌ Error downloading media:\n${error.message}`);
                                    return;
                                }

                                // Send file to Telegram
                                try {
                                    await sendDocument(chatId, fileName);
                                    await sendMessage(chatId, `✅ Download complete and sent to you!`);
                                } catch (e) {
                                    console.error("Send file error:", e);
                                    await sendMessage(chatId, `❌ Error sending file to Telegram.`);
                                }

                                // Delete temporary file
                                fs.unlink(fileName, () => {});
                            });
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
