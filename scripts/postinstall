#!/bin/bash

# Postinstall script for Offlyn Helper .pkg
# This runs automatically after the .pkg installs files to ~/.offlyn/

set -e

# Get the current user (not root, since installer runs as root)
CURRENT_USER=$(stat -f "%Su" /dev/console)
USER_HOME=$(eval echo "~$CURRENT_USER")
OFFLYN_DIR="$USER_HOME/.offlyn"

echo "Offlyn Helper: Starting post-installation setup..."
echo "User: $CURRENT_USER"
echo "Home: $USER_HOME"
echo "Offlyn Dir: $OFFLYN_DIR"

# Ensure the setup script exists and is executable
if [ ! -f "$OFFLYN_DIR/setup-mac.sh" ]; then
    echo "ERROR: setup-mac.sh not found in $OFFLYN_DIR"
    exit 1
fi

chmod +x "$OFFLYN_DIR/setup-mac.sh"

# Run the setup script as the actual user (not root)
echo "Running Ollama setup as user $CURRENT_USER..."
sudo -u "$CURRENT_USER" bash "$OFFLYN_DIR/setup-mac.sh"

echo "Offlyn Helper: Post-installation setup completed successfully!"
exit 0