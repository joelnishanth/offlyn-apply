#!/bin/bash

echo "======================================"
echo "Offlyn Apply Native Host Installer"
echo "======================================"
echo ""

# Check if extension ID provided as argument
if [ -z "$1" ]; then
  echo "ERROR: Extension ID required!"
  echo ""
  echo "Usage: ./reinstall.sh YOUR_EXTENSION_ID"
  echo ""
  echo "To find your extension ID:"
  echo "1. Open Firefox"
  echo "2. Go to: about:debugging#/runtime/this-firefox"
  echo "3. Find 'Offlyn Apply' extension"
  echo "4. Copy the Internal UUID (looks like: {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx})"
  echo ""
  echo "Then run:"
  echo "  ./reinstall.sh '{your-id-here}'"
  echo ""
  exit 1
fi

EXTENSION_ID="$1"

echo "Installing native host with Extension ID: $EXTENSION_ID"
echo ""

# Get absolute path to launcher.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER_PATH="$SCRIPT_DIR/launcher.sh"

# Create manifest
MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
MANIFEST_FILE="$MANIFEST_DIR/ai.offlyn.helper.json"

# Create directory if needed
mkdir -p "$MANIFEST_DIR"

# Write manifest
cat > "$MANIFEST_FILE" << EOF
{
  "name": "ai.offlyn.helper",
  "description": "Offlyn Apply desktop bridge (Ollama) for job application form filling",
  "type": "stdio",
  "path": "$LAUNCHER_PATH",
  "allowed_extensions": [
    "$EXTENSION_ID"
  ]
}
EOF

echo "✓ Manifest created at: $MANIFEST_FILE"
echo ""
echo "Manifest contents:"
cat "$MANIFEST_FILE"
echo ""
echo "======================================"
echo "Installation Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Go to Firefox: about:debugging"
echo "2. Click 'Reload' on the Offlyn Apply extension"
echo "3. Open the extension popup - should show 'Native Host Connected'"
echo "4. Try the onboarding page again"
echo ""
