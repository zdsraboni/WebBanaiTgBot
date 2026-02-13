FROM node:18-alpine

# ১. পাইথন, এফএফএমপেগ এবং সিএ-সার্টিফিকেটস ইন্সটল (কুকি ও এসএসএল স্ট্যাবিলিটির জন্য)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    ca-certificates

# ২. পাইপ আপডেট এবং yt-dlp এর একদম লেটেস্ট ভার্সন ইন্সটল নিশ্চিত করা
RUN python3 -m pip install --upgrade pip --break-system-packages \
    && python3 -m pip install --upgrade yt-dlp --break-system-packages

WORKDIR /usr/src/app

# ৩. ডিপেন্ডেন্সি ইন্সটল
COPY package*.json ./
RUN npm install --production

# ৪. সোর্স কোড কপি করা
COPY . .

# ৫. ডাউনলোড ফোল্ডার তৈরি নিশ্চিত করা (যাতে পারমিশন এরর না হয়)
RUN mkdir -p downloads && chmod 777 downloads

ENV PORT=3000
EXPOSE 3000

# ৬. বট স্টার্ট কমান্ড
CMD [ "npm", "start" ]
