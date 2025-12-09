# Use Debian (Stable) instead of Alpine (Buggy)
FROM node:18-bullseye

# Install Python & FFmpeg
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg

# Install yt-dlp globally
RUN python3 -m pip install --upgrade pip --break-system-packages \
    && python3 -m pip install yt-dlp --break-system-packages

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

# Hugging Face Spaces requires Port 7860
ENV PORT=7860
EXPOSE 7860

CMD [ "npm", "start" ]