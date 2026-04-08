#!/bin/bash

# WhatsApp Daily Summary Sender
# 
# This script sends a job application summary to WhatsApp via OpenClaw.
# 
# Usage:
#   ./send-whatsapp-summary.sh "+15555550123" "Your summary message here"
#
# Or manually with openclaw:
#   openclaw message send --channel whatsapp --target "+15555550123" --message "Summary text"

set -e

if [ $# -lt 2 ]; then
  echo "Usage: $0 <whatsapp-number> <message>"
  echo "Example: $0 '+15555550123' 'Daily job summary...'"
  exit 1
fi

TARGET="$1"
MESSAGE="$2"

echo "📤 Sending WhatsApp summary to $TARGET..."
echo ""

openclaw message send \
  --channel whatsapp \
  --target "$TARGET" \
  --message "$MESSAGE"

if [ $? -eq 0 ]; then
  echo ""
  echo "[OK] Summary sent successfully!"
else
  echo ""
  echo "[FAIL] Failed to send summary"
  exit 1
fi
