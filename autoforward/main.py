import os
import asyncio
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.functions.messages import SendReactionRequest
from telethon.tl.types import ReactionEmoji
from aiohttp import web

# ==========================================
# 1. CREDENTIALS
# ==========================================
API_ID = int(os.environ.get('API_ID', '38622204'))
API_HASH = os.environ.get('API_HASH', 'd1da3bccca8184f39121e020c9b9dd44')
SESSION_STRING = os.environ.get('SESSION_STRING')

# ==========================================
# 2. CONFIG
# ==========================================
DEFAULT_DESTINATION = 'UsBabyUs'
# You can change 'me' to your log channel username (e.g., '@MyLogChannel')
LOG_CHAT = 'me' 
LOGGING_ENABLED = True

print("Starting Cloud Bot...")

# Initialize Client
try:
    client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
except Exception as e:
    print(f"Error initializing client: {e}")
    exit()

# ==========================================
# 3. FAKE WEB SERVER (KEEPS RENDER ALIVE)
# ==========================================
async def handle(request):
    return web.Response(text="Bot is Running!")

async def start_server():
    app = web.Application()
    app.router.add_get('/', handle)
    runner = web.AppRunner(app)
    await runner.setup()
    # Render provides the PORT variable
    port = int(os.environ.get("PORT", 8080))
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    print(f"Web server started on port {port}")

# ==========================================
# 4. BOT FUNCTIONS
# ==========================================

async def send_log(text):
    """Sends logs to Telegram"""
    print(text) # Print to Render Console
    if LOGGING_ENABLED:
        try:
            await client.send_message(LOG_CHAT, f"<code>{text}</code>")
        except:
            pass

@client.on(events.NewMessage(pattern='(?i)^/logs'))
async def log_toggle_handler(event):
    if not event.out: return
    global LOGGING_ENABLED
    if 'on' in event.text.lower():
        LOGGING_ENABLED = True
        await event.edit("✅ Logs ON")
    elif 'off' in event.text.lower():
        LOGGING_ENABLED = False
        await event.edit("❌ Logs OFF")

@client.on(events.NewMessage(pattern='(?i)^/fr'))
async def handler(event):
    if not event.out or not event.is_reply: return

    try:
        original_msg = await event.get_reply_message()
        target = DEFAULT_DESTINATION
        parts = event.text.split()
        if len(parts) > 1 and parts[1].startswith('@'):
            target = parts[1]

        await send_log(f"-> Copying to: {target}...")

        # Send Copy
        await client.send_message(target, original_msg)
        await send_log("-> Success!")

        # React
        try:
            await client(SendReactionRequest(
                peer=event.chat_id,
                msg_id=original_msg.id,
                reaction=[ReactionEmoji(emoticon='⚡')] 
            ))
        except: pass

        # Delete Command
        await event.delete()

    except Exception as e:
        await send_log(f"Error: {e}")

# ==========================================
# 5. STARTUP
# ==========================================
async def main():
    await client.start()
    print("Telegram Client Online")
    
    # Start the fake web server
    await start_server()
    
    if LOGGING_ENABLED:
        try:
            await client.send_message(LOG_CHAT, "🚀 **Cloud Bot v2 Started!**\nServer is listening.")
        except: pass
        
    await client.run_until_disconnected()

if __name__ == '__main__':
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())