#!/usr/bin/env bash
# Offlyn AI Setup — macOS
# Installs Ollama, pulls required models, configures CORS permanently.
# Runs without user interaction after launch.
set -euo pipefail

# ── Extend PATH for Homebrew (not inherited from browser environments) ─────
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$PATH"

ORIGINS="chrome-extension://*,moz-extension://*"
PLIST="$HOME/Library/LaunchAgents/ai.offlyn.ollama-cors.plist"

echo ""
echo "  Offlyn AI Setup — macOS"
echo "  ─────────────────────────────────────────"
echo ""

# ── Step 1: Install Ollama if needed ──────────────────────────────────────
OFFLYN_BIN="$HOME/.offlyn/ollama"

_OLLAMA=""
# 1. Check ~/.offlyn/ollama (our managed CLI install) first
if [ -x "$OFFLYN_BIN" ]; then
  _OLLAMA="$OFFLYN_BIN"
fi
# 2. Check Homebrew-installed ollama (real standalone binary, not an app-bundle symlink)
if [ -z "$_OLLAMA" ]; then
  for _brew_bin in /opt/homebrew/bin/ollama /opt/homebrew/Cellar/ollama/*/bin/ollama /usr/local/Cellar/ollama/*/bin/ollama; do
    if [ -f "$_brew_bin" ] && [ -x "$_brew_bin" ]; then
      _OLLAMA="$_brew_bin"
      break
    fi
  done
fi
# Do NOT fall back to /usr/local/bin/ollama — it's a symlink into the .app bundle
# which requires the full macOS app framework context to serve correctly.

if [ -n "$_OLLAMA" ]; then
  echo "✓ Ollama already installed at $_OLLAMA"
else
  echo "→ Downloading Ollama CLI (~70 MB)..."
  TMP_TGZ="/tmp/offlyn-ollama-setup-$$.tgz"
  curl -fL "https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz" \
       -o "$TMP_TGZ" --no-progress-meter

  echo "→ Installing Ollama to ~/.offlyn/..."
  mkdir -p "$HOME/.offlyn"
  tar -xzf "$TMP_TGZ" -C "$HOME/.offlyn/" ollama 2>/dev/null || tar -xzf "$TMP_TGZ" -C "$HOME/.offlyn/"
  rm -f "$TMP_TGZ"
  chmod +x "$OFFLYN_BIN"
  xattr -dr com.apple.quarantine "$OFFLYN_BIN" 2>/dev/null || true
  _OLLAMA="$OFFLYN_BIN"
  echo "✓ Ollama installed"
fi

# ── Step 2: Configure CORS permanently via LaunchAgent ────────────────────
echo "→ Configuring browser extension access (CORS)..."

# Stop existing Ollama so it restarts with the new env var
pkill -f "Ollama" 2>/dev/null || true
sleep 2

mkdir -p "$(dirname "$PLIST")"

cat > "$PLIST" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.offlyn.ollama-cors</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>launchctl setenv OLLAMA_ORIGINS "$ORIGINS"</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
launchctl setenv OLLAMA_ORIGINS "$ORIGINS"
echo "✓ CORS configured (persists across reboots)"

# ── Step 3: Start Ollama ───────────────────────────────────────────────────
echo "→ Starting Ollama..."
if [ -z "$_OLLAMA" ] || [ ! -x "$_OLLAMA" ]; then
  echo "✗ Cannot start Ollama: no binary found." && exit 1
fi
# Redirect stdin to /dev/null so the process doesn't inherit the native messaging socket.
nohup "$_OLLAMA" serve </dev/null &>/dev/null &

echo "→ Waiting for Ollama to be ready (up to 30s)..."
for i in $(seq 1 30); do
  if curl -s http://localhost:11434/api/version &>/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -s http://localhost:11434/api/version &>/dev/null; then
  echo "✗ Ollama did not start in time."
  echo "  Please open Ollama from /Applications and re-run this script."
  exit 1
fi
echo "✓ Ollama is running"

# ── Step 4: Pull models ────────────────────────────────────────────────────
if "$_OLLAMA" list 2>/dev/null | grep -q "llama3.2"; then
  echo "✓ llama3.2 already downloaded"
else
  echo "→ Downloading llama3.2 (~2.2 GB — this takes several minutes)..."
  "$_OLLAMA" pull llama3.2
fi

if "$_OLLAMA" list 2>/dev/null | grep -q "nomic-embed-text"; then
  echo "✓ nomic-embed-text already downloaded"
else
  echo "→ Downloading nomic-embed-text (~274 MB)..."
  "$_OLLAMA" pull nomic-embed-text
fi

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ Setup complete!"
echo "  ─────────────────────────────────────────"
echo "  Return to the Offlyn extension and click"
echo "  'Test Connection' to verify."
echo "  ─────────────────────────────────────────"
echo ""
