#!/usr/bin/env bash
# Offlyn AI Setup — Linux
# Installs Ollama, pulls required models, configures CORS permanently.
# Runs without user interaction after launch (may prompt for sudo password once).
set -euo pipefail

ORIGINS="chrome-extension://*,moz-extension://*"

echo ""
echo "  Offlyn AI Setup — Linux"
echo "  ─────────────────────────────────────────"
echo ""

# ── Step 1: Install Ollama if needed ──────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  echo "→ Installing Ollama (requires sudo)..."
  curl -fsSL https://ollama.com/install.sh | sh
  echo "✓ Ollama installed"
else
  echo "✓ Ollama already installed"
fi

# ── Step 2: Configure CORS permanently ────────────────────────────────────
echo "→ Configuring browser extension access (CORS)..."

# Shell config (for terminal-launched ollama)
for rc in ~/.bashrc ~/.profile ~/.bash_profile; do
  if [ -f "$rc" ]; then
    sed -i '/OLLAMA_ORIGINS/d' "$rc" 2>/dev/null || true
    echo "export OLLAMA_ORIGINS=\"$ORIGINS\"" >> "$rc"
  fi
done
export OLLAMA_ORIGINS="$ORIGINS"

# systemd service override (for system-managed Ollama)
if command -v systemctl &>/dev/null && systemctl list-unit-files ollama.service &>/dev/null 2>&1; then
  OVERRIDE_DIR="/etc/systemd/system/ollama.service.d"
  sudo mkdir -p "$OVERRIDE_DIR"
  sudo tee "$OVERRIDE_DIR/cors-override.conf" > /dev/null << CONF
[Service]
Environment="OLLAMA_ORIGINS=$ORIGINS"
CONF
  sudo systemctl daemon-reload
  sudo systemctl restart ollama
  echo "✓ CORS configured via systemd (persists across reboots)"
else
  echo "✓ CORS configured in shell profile"
  # Start ollama manually if not running
  if ! pgrep -x ollama &>/dev/null; then
    ollama serve &>/dev/null &
  fi
fi

# ── Step 3: Wait for Ollama ────────────────────────────────────────────────
echo "→ Waiting for Ollama to be ready (up to 30s)..."
for i in $(seq 1 30); do
  if curl -s http://localhost:11434/api/version &>/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -s http://localhost:11434/api/version &>/dev/null; then
  echo "✗ Ollama did not start. Please start it with 'ollama serve' and re-run."
  exit 1
fi
echo "✓ Ollama is running"

# ── Step 4: Pull models ────────────────────────────────────────────────────
if ollama list 2>/dev/null | grep -q "llama3.2"; then
  echo "✓ llama3.2 already downloaded"
else
  echo "→ Downloading llama3.2 (~2.2 GB — this takes several minutes)..."
  ollama pull llama3.2
fi

if ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
  echo "✓ nomic-embed-text already downloaded"
else
  echo "→ Downloading nomic-embed-text (~274 MB)..."
  ollama pull nomic-embed-text
fi

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ Setup complete!"
echo "  ─────────────────────────────────────────"
echo "  Return to the Offlyn extension and click"
echo "  'Test Connection' to verify."
echo "  ─────────────────────────────────────────"
echo ""
read -rp "Press Enter to close..."
