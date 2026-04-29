#!/bin/bash

echo ""
echo "=========================================="
echo "Offlyn Apply Native Host Diagnostic"
echo "=========================================="
echo ""

# Check 1: Manifest
echo "1. Checking manifest..."
MANIFEST="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/ai.offlyn.desktop.json"
if [ -f "$MANIFEST" ]; then
    echo "✓ Manifest exists"
    echo ""
    cat "$MANIFEST"
    echo ""
else
    echo "✗ Manifest NOT found at: $MANIFEST"
    exit 1
fi

# Check 2: Extension ID match
echo ""
echo "2. Checking extension ID..."
MANIFEST_ID=$(cat "$MANIFEST" | python3 -c "import sys, json; print(json.load(sys.stdin)['allowed_extensions'][0])" 2>/dev/null)
echo "Manifest expects: $MANIFEST_ID"
echo ""

# Check 3: Launcher
echo "3. Checking launcher script..."
LAUNCHER=$(cat "$MANIFEST" | python3 -c "import sys, json; print(json.load(sys.stdin)['path'])")
if [ -f "$LAUNCHER" ]; then
    echo "✓ Launcher exists: $LAUNCHER"
    if [ -x "$LAUNCHER" ]; then
        echo "✓ Launcher is executable"
    else
        echo "✗ Launcher is NOT executable"
        chmod +x "$LAUNCHER"
        echo "✓ Fixed: Made launcher executable"
    fi
else
    echo "✗ Launcher NOT found: $LAUNCHER"
    exit 1
fi

# Check 4: Node
echo ""
echo "4. Checking Node.js..."
NODE_PATH=$(head -5 "$LAUNCHER" | grep "node" | grep -o '"/.*node"' | tr -d '"')
if [ -n "$NODE_PATH" ] && [ -f "$NODE_PATH" ]; then
    echo "✓ Node found: $NODE_PATH"
    NODE_VERSION=$("$NODE_PATH" --version)
    echo "  Version: $NODE_VERSION"
else
    echo "✗ Node NOT found at: $NODE_PATH"
    exit 1
fi

# Check 5: index.js
echo ""
echo "5. Checking index.js..."
INDEX_FILE="$(dirname "$LAUNCHER")/index.js"
if [ -f "$INDEX_FILE" ]; then
    echo "✓ index.js exists"
    # Quick syntax check
    "$NODE_PATH" --check "$INDEX_FILE" 2>&1 | head -5
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        echo "✓ index.js has valid syntax"
    else
        echo "✗ index.js has syntax errors!"
        exit 1
    fi
else
    echo "✗ index.js NOT found: $INDEX_FILE"
    exit 1
fi

# Check 6: Ollama
echo ""
echo "6. Checking Ollama..."
if curl -s http://localhost:11434/api/version > /dev/null 2>&1; then
    OLLAMA_VERSION=$(curl -s http://localhost:11434/api/version | python3 -c "import sys, json; print(json.load(sys.stdin)['version'])" 2>/dev/null)
    echo "✓ Ollama is running (version: $OLLAMA_VERSION)"
else
    echo "⚠ Ollama is NOT responding at http://localhost:11434"
    echo "  (This is OK, but resume parsing won't work)"
fi

# Check 7: Test native host startup
echo ""
echo "7. Testing native host startup..."
echo "" | "$NODE_PATH" "$INDEX_FILE" > /dev/null 2>&1 &
TEST_PID=$!
sleep 2

if ps -p $TEST_PID > /dev/null 2>&1; then
    echo "✓ Native host starts successfully"
    kill $TEST_PID 2>/dev/null
    wait $TEST_PID 2>/dev/null
else
    echo "✗ Native host crashed on startup"
    echo ""
    echo "Check logs:"
    tail -20 "$(dirname "$LAUNCHER")/native-host.log"
    exit 1
fi

# Check 8: Recent logs
echo ""
echo "8. Recent native host activity:"
LOG_FILE="$(dirname "$LAUNCHER")/native-host.log"
if [ -f "$LOG_FILE" ]; then
    echo "Last 10 log entries:"
    tail -10 "$LOG_FILE"
else
    echo "(No log file yet)"
fi

echo ""
echo "=========================================="
echo "✓ All checks passed!"
echo "=========================================="
echo ""
echo "Firefox should be able to connect."
echo ""
echo "NEXT STEPS:"
echo "1. In Firefox, go to: about:debugging#/runtime/this-firefox"
echo "2. Find 'Offlyn Apply' extension"
echo "3. Click 'Inspect' button (opens background console)"
echo "4. In the background console, look for lines with [OA]"
echo "5. Look for: 'Native host disconnected with error'"
echo "6. Copy that ENTIRE error line and share it"
echo ""
echo "To watch live connection attempts:"
echo "  tail -f \"$LOG_FILE\""
echo ""
