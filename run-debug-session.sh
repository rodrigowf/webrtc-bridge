#!/bin/bash

# Interactive Debug Session Runner
# This script helps you run the interactive debugging session

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  WebRTC Bridge - Interactive Debug Session Setup              ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Load nvm
echo "→ Loading nvm..."
if [ -f ~/.nvm/nvm.sh ]; then
    source ~/.nvm/nvm.sh
else
    echo "✗ Error: nvm not found at ~/.nvm/nvm.sh"
    exit 1
fi

# Check if server is already running
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "✓ Server is already running on port 8080"
    echo ""
    echo "┌────────────────────────────────────────────────────────────────┐"
    echo "│  READY TO START INTERACTIVE TEST                              │"
    echo "└────────────────────────────────────────────────────────────────┘"
    echo ""
    echo "Run in a new terminal:"
    echo "  source ~/.nvm/nvm.sh && npm run test:interactive"
    echo ""
else
    echo "✗ Server is not running on port 8080"
    echo ""
    echo "┌────────────────────────────────────────────────────────────────┐"
    echo "│  SETUP INSTRUCTIONS                                            │"
    echo "└────────────────────────────────────────────────────────────────┘"
    echo ""
    echo "You need TWO terminal windows/tabs:"
    echo ""
    echo "Terminal 1 (Backend Logs):"
    echo "  cd $(pwd)"
    echo "  source ~/.nvm/nvm.sh && npm start"
    echo ""
    echo "Terminal 2 (Frontend Logs + Browser):"
    echo "  cd $(pwd)"
    echo "  source ~/.nvm/nvm.sh && npm run test:interactive"
    echo ""
fi

echo "For more details, see: DEBUGGING.md"
echo ""
