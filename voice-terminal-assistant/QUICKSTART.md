# 🚀 Quick Start Guide

Get your Voice Terminal Assistant running in 5 minutes!

## Prerequisites Check

Before starting, ensure you have:
- [ ] Node.js 18+ installed (`node --version`)
- [ ] An OpenAI API key with Realtime API access
- [ ] openssl installed (for SSL certs: `openssl version`)

## Step-by-Step Setup

### 1. Install Dependencies

```bash
cd voice-terminal-assistant
npm install
```

### 2. Configure API Key

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your OpenAI API key
# Use your favorite editor (nano, vim, code, etc.)
nano .env
```

Add your key:
```env
OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE
```

### 3. Build the Project

```bash
npm run build
```

You should see TypeScript compilation output with no errors.

### 4. Start the Server

```bash
npm start
```

You should see:
```
[CONFIG] Loading environment configuration...
[CONFIG] PORT: 8765
[CONFIG] OPENAI_API_KEY: sk-proj-...
[SERVER] ============================================
[SERVER] Voice Terminal Assistant
[SERVER] ============================================
[SERVER] HTTPS server listening on port 8765
[SERVER] Open in browser: https://localhost:8765
[SERVER] ============================================
```

### 5. Open in Browser

1. Navigate to `https://localhost:8765`
2. You'll see a security warning (self-signed certificate)
3. Click "Advanced" → "Proceed to localhost"

### 6. Start Using

1. Click **"Start Services"** button
2. Grant microphone access when prompted
3. Click **"Unmute Mic"** to enable your microphone
4. Click **"Unmute AI"** to hear the AI's voice responses
5. **Start speaking!**

## First Commands to Try

### Simple Commands (No confirmation needed):
- "What's the current directory?"
- "List the files in my home directory"
- "Show me my username"
- "What time is it?"
- "Show me disk usage"

### Commands Requiring Confirmation:
- "Create a new directory called test"
- "Delete the test directory"
- "Install cowsay using brew" (macOS)

## Troubleshooting

### Can't connect?
- Make sure you clicked "Start Services" first
- Check that your OpenAI API key is correct in `.env`
- Look at the terminal output for error messages

### No microphone access?
- WebRTC requires HTTPS (or localhost)
- Check browser permissions
- Try a different browser (Chrome/Edge work best)

### SSL certificate warning?
- This is normal for self-signed certificates
- Safe to proceed on localhost
- To remove warning: install [mkcert](https://github.com/FiloSottile/mkcert)

### Commands not executing?
- Make sure both "Unmute Mic" and "Unmute AI" are pressed
- Check the "Terminal" tab for execution results
- Look at server logs for errors

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Experiment with different voice commands
- Check the "Transcriptions" tab to see what the AI heard
- Monitor the "Terminal" tab to see command execution

## Tips

1. **Speak Clearly**: The AI uses Whisper for transcription - it's very accurate
2. **Be Natural**: No need for specific commands - speak naturally
3. **Wait for Confirmation**: For dangerous commands, the AI will ask you to confirm verbally
4. **Check Tabs**: Switch between "Transcriptions" and "Terminal" tabs to see different views
5. **Multiple Windows**: You can open multiple browser tabs - they all share the same session

## Common Issues

**Issue**: "Services not started" error when connecting
- **Solution**: Click "Start Services" button before the browser tries to connect

**Issue**: No audio from AI
- **Solution**: Click "Unmute AI" button - it starts muted by default

**Issue**: AI can't hear me
- **Solution**: Click "Unmute Mic" button - it starts muted by default

**Issue**: Build fails with TypeScript errors
- **Solution**: Make sure you're using Node.js 18+ and have installed dependencies

## Security Reminder

⚠️ **This application executes commands on your local machine!**

- Always listen carefully to confirmation requests
- Don't run this on a production server
- Consider using a VM or container for extra safety
- Never expose this to the public internet

## Getting Help

If you encounter issues:
1. Check the server terminal for error logs
2. Check the browser console (F12) for frontend errors
3. Review the README.md for more detailed troubleshooting
4. Verify your OpenAI API key has Realtime API access

---

**Ready to go!** Start speaking commands and watch the magic happen! 🎉
