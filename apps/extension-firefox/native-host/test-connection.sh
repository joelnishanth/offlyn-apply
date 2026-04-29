#!/bin/bash

echo "================================"
echo "Native Host Connection Test"
echo "================================"
echo ""

echo "1. Checking manifest file..."
MANIFEST_FILE="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/ai.offlyn.desktop.json"
if [ -f "$MANIFEST_FILE" ]; then
    echo "✓ Manifest exists at: $MANIFEST_FILE"
    echo ""
    echo "Contents:"
    cat "$MANIFEST_FILE"
    echo ""
else
    echo "✗ Manifest NOT found at: $MANIFEST_FILE"
    exit 1
fi

echo ""
echo "2. Checking launcher script..."
LAUNCHER=$(cat "$MANIFEST_FILE" | python3 -c "import sys, json; print(json.load(sys.stdin)['path'])")
if [ -f "$LAUNCHER" ]; then
    echo "✓ Launcher exists at: $LAUNCHER"
    if [ -x "$LAUNCHER" ]; then
        echo "✓ Launcher is executable"
    else
        echo "✗ Launcher is NOT executable"
        exit 1
    fi
else
    echo "✗ Launcher NOT found at: $LAUNCHER"
    exit 1
fi

echo ""
echo "3. Checking index.js..."
INDEX_FILE="$(dirname "$LAUNCHER")/index.js"
if [ -f "$INDEX_FILE" ]; then
    echo "✓ index.js exists"
else
    echo "✗ index.js NOT found"
    exit 1
fi

echo ""
echo "4. Testing native host startup..."
echo '{"kind":"TEST"}' | "$LAUNCHER" > /dev/null 2>&1 &
PID=$!
sleep 2

if ps -p $PID > /dev/null 2>&1; then
    echo "✓ Native host started successfully (PID: $PID)"
    kill $PID 2>/dev/null
else
    echo "✗ Native host failed to start or crashed"
    echo ""
    echo "Check logs:"
    tail -10 "$(dirname "$LAUNCHER")/native-host.log"
    exit 1
fi

echo ""
echo "================================"
echo "All checks passed!"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Go to Firefox: about:debugging"
echo "2. Reload the Offlyn Apply extension"
echo "3. Click the extension icon"
echo "4. Should show 'Native Host Connected'"
echo ""
