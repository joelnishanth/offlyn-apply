#!/usr/bin/env bash
# Offlyn Helper Installer — macOS / Linux
# Installs the native messaging host so the Offlyn extension can run Ollama
# setup with a single button click (no terminal needed afterwards).
set -euo pipefail

HOST_NAME="ai.offlyn.helper"
OFFLYN_DIR="$HOME/.offlyn"
HOST_SCRIPT="$OFFLYN_DIR/helper.py"
HOST_WRAPPER="$OFFLYN_DIR/helper.sh"
RAW_BASE="https://raw.githubusercontent.com/joelnishanth/offlyn-apply/main/scripts/native-host"
SETUP_BASE="https://raw.githubusercontent.com/joelnishanth/offlyn-apply/main/scripts/setup-ollama"

CHROME_EXT_ID="bjllpojjllhfghiemokcoknfmhpmfbph"
FIREFOX_EXT_ID="{e0857c2d-15a6-4d0c-935e-57761715dc3d}"

echo ""
echo "  Installing Offlyn Helper..."
echo ""

# ── Create directory & download host + setup scripts ─────────────────────
mkdir -p "$OFFLYN_DIR"
curl -fsSL "$RAW_BASE/host.py" -o "$HOST_SCRIPT"
chmod +x "$HOST_SCRIPT"

OS="$(uname)"
if [ "$OS" = "Darwin" ]; then
  curl -fsSL "$SETUP_BASE/setup-mac.sh" -o "$OFFLYN_DIR/setup-mac.sh"
  chmod +x "$OFFLYN_DIR/setup-mac.sh"
else
  curl -fsSL "$SETUP_BASE/setup-linux.sh" -o "$OFFLYN_DIR/setup-linux.sh"
  chmod +x "$OFFLYN_DIR/setup-linux.sh"
fi

# ── Detect Python 3 path ──────────────────────────────────────────────────
PYTHON_PATH=""
for candidate in /usr/bin/python3 /usr/local/bin/python3 "$(command -v python3 2>/dev/null || true)"; do
  if [ -x "$candidate" ]; then
    PYTHON_PATH="$candidate"
    break
  fi
done

if [ -z "$PYTHON_PATH" ]; then
  echo "✗ Python 3 is required but not found."
  echo "  Install it with: brew install python3  (macOS)"
  echo "  or: sudo apt install python3  (Linux)"
  exit 1
fi

# Rewrite the shebang to use the detected Python path
sed -i'' "s|#!/usr/bin/env python3|#!$PYTHON_PATH|" "$HOST_SCRIPT" 2>/dev/null || true

# ── Create a shell wrapper for Firefox (Firefox can't reliably exec Python shebangs on macOS) ──
cat > "$HOST_WRAPPER" << WRAPPER_EOF
#!/bin/bash
exec "$PYTHON_PATH" "$HOST_SCRIPT" "\$@"
WRAPPER_EOF
chmod +x "$HOST_WRAPPER"

# ── Build manifests (Chrome uses .py directly; Firefox needs the .sh wrapper) ─
CHROME_MANIFEST=$(cat << MANIFEST_EOF
{
  "name": "$HOST_NAME",
  "description": "Offlyn AI Setup Helper",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$CHROME_EXT_ID/"]
}
MANIFEST_EOF
)

FIREFOX_MANIFEST=$(cat << MANIFEST_EOF
{
  "name": "$HOST_NAME",
  "description": "Offlyn AI Setup Helper",
  "path": "$HOST_WRAPPER",
  "type": "stdio",
  "allowed_extensions": ["$FIREFOX_EXT_ID"]
}
MANIFEST_EOF
)

# ── Register for Chrome / Chromium ───────────────────────────────────────
OS="$(uname)"
if [ "$OS" = "Darwin" ]; then
  CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  CHROMIUM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  FIREFOX_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
else
  CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
  CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
  FIREFOX_DIR="$HOME/.mozilla/native-messaging-hosts"
fi

for DIR in "$CHROME_DIR" "$CHROMIUM_DIR"; do
  mkdir -p "$DIR"
  echo "$CHROME_MANIFEST" > "$DIR/$HOST_NAME.json"
done

mkdir -p "$FIREFOX_DIR"
echo "$FIREFOX_MANIFEST" > "$FIREFOX_DIR/$HOST_NAME.json"

echo "✓ Offlyn Helper installed"
echo ""
echo "  Return to the Offlyn extension and click"
echo "  the 'Set Up AI' button — it will handle"
echo "  everything from here."
echo ""
