🤖 Media Banai Bot
Media Banai Bot is a professional, high-performance Telegram bot designed to download media from Reddit and Twitter (X).

It features a robust anti-blocking system that utilizes cookie authentication, user-agent spoofing, and mirror rotation to bypass Reddit's strict API limitations (Error 403) and Twitter's restrictions.

✨ Features
🚀 Universal Downloader: Supports Videos, Images, GIFs, and Galleries/Albums.
🛡️ Anti-Block System:
Android Impersonation: Mimics the Reddit Mobile App to bypass server blocks.
Mirror Rotation: Automatically switches between 7+ Redlib mirrors if the main API fails.
Cookie Auth: Uses authenticated sessions for premium/mature content access.
🐦 Advanced Twitter Support:
Uses FxTwitter API for reliable media detection.
Fail-safe mechanism ensures video downloads even if quality selection fails.
🎛️ Quality Control: Choose between specific video resolutions (1080p, 720p, etc.) or Audio Only (MP3).
🐳 Dockerized: Fully containerized with FFmpeg and Python pre-installed for easy deployment.
🛠️ Tech Stack
Runtime: Node.js
Framework: Telegraf (Telegram Bot API)
Engine: yt-dlp (Media Extraction) & FFmpeg (Processing)
Architecture: Modular (Services & Utils separated)
Hosting: Render (Docker Support)
🚀 Deployment Guide (Render)
This bot is optimized for Render's Free Tier using Docker.

Prerequisites
Telegram Bot Token: Get it from @BotFather.
Reddit Cookies (Optional but Recommended): Export cookies from your browser using the "Get cookies.txt LOCALLY" extension.
Step 1: Deploy Code
Fork/Clone this repository to your GitHub.
Create a new Web Service on Render.
Connect your repository.
Step 2: Configure Render
Runtime: Select Docker (Crucial! Do not select Node).
Instance Type: Free.
Step 3: Environment Variables
Add the following variables in the Render Dashboard (Environment tab):

Key	Value	Description
BOT_TOKEN	123456:ABC-DEF...	Your Telegram Bot Token.
REDDIT_COOKIES	# Netscape HTTP...	(Optional) Paste your full cookies.txt content here to authenticate as a logged-in user.
Step 4: Finish
Click Deploy. Render will build the Docker image (installing Python, FFmpeg, and Node.js). Once the logs say Your service is live, your bot is ready!

📂 Project Structure
media-banai-tg-bot/
│
├── package.json               # Dependencies
├── Dockerfile                 # Render Setup
├── index.js                   # Main Bot Controller
│
└── src/
    ├── config/
    │   └── settings.js        # Global Variables & Constants
    │
    ├── utils/
    │   └── downloader.js      # yt-dlp & Cookie Manager
    │
    └── services/              # Logic Modules
        ├── reddit.js          # Reddit Mirror & API Logic
        └── twitter.js         # Twitter API & Fail-safe Logic
💻 Local Development
Clone the repo:
git clone [https://github.com/YourUsername/MediaBanaiTgBot.git](https://github.com/YourUsername/MediaBanaiTgBot.git)
Install dependencies:
npm install
Ensure you have Python, FFmpeg, and yt-dlp installed on your machine.
Create a .env file with your BOT_TOKEN.
Run the bot:
npm start
🐛 Troubleshooting
"Media not found": The post might be deleted, private, or from an unsupported external domain.
"Access Denied": If using cookies, ensure they are up to date. The bot works in "Anonymous Mode" without them but may face rate limits.
Bot not responding: Check Render logs. The free tier puts the bot to sleep after inactivity; send a message and wait 30s for it to wake up.
📝 License
This project is open-source. Feel free to modify and distribute.
