import os
import sys
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

# ✅ READ FROM ENV (Injected by Node.js Bot)
api_id = os.environ.get('API_ID')
api_hash = os.environ.get('API_HASH')

if not api_id or not api_hash:
    print("Error: API_ID or API_HASH missing in environment.")
    sys.exit(1)

print("--- TELEGRAM SESSION GENERATOR ---")
print("Logging in... (Check Telegram Bot for prompts)")

# Interactive Login
# When this runs, Telethon asks for phone number on STDIN.
# Node.js will pipe your Telegram message to this STDIN.
with TelegramClient(StringSession(), int(api_id), api_hash) as client:
    session_string = client.session.save()
    
    # OUTPUT ONLY THE SESSION STRING AT THE END
    print("\n✅ LOGIN SUCCESSFUL!")
    print(session_string) 
    # Node.js is watching for this string to save it to DB
