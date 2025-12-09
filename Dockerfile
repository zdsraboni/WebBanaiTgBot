# Use Debian Bullseye (Stable Internet, No DNS bugs)
FROM node:18-bullseye

# 1. Install Python and FFmpeg
# We use apt-get which is standard and stable
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 2. Install yt-dlp
# IMPORTANT: We removed '--break-system-packages' because Debian Bullseye doesn't support it
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir yt-dlp

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

# Hugging Face Spaces requires Port 7860
ENV PORT=7860
EXPOSE 7860

CMD [ "npm", "start" ]