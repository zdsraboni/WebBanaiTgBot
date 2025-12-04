# Use Node.js on Alpine Linux
FROM node:18-alpine

# Install Python3, pip, and ffmpeg (Required for yt-dlp and video merging)
RUN apk add --no-cache python3 py3-pip ffmpeg

# Install yt-dlp (The media downloader tool)
# We use break-system-packages to allow global install on Alpine
RUN python3 -m pip install --upgrade pip --break-system-packages \
    && python3 -m pip install yt-dlp --break-system-packages

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app source code
COPY . .

# Expose port 3000
EXPOSE 3000

# Start command
CMD [ "npm", "start" ]
