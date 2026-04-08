#!/bin/bash

# Test WhatsApp Summary Sending
# This creates a sample summary and sends it via OpenClaw

set -e

# Sample job application summary (what the extension would generate)
TEST_SUMMARY="Daily Job Application Summary (2026-02-02)

Total: 3 positions
Submitted: 2
Detected: 1

Details:

1. [Submitted] Senior Software Engineer
   Company: Acme Corp
   ATS: Greenhouse

2. [Submitted] Full Stack Developer
   Company: Tech Startup Inc
   ATS: Lever

3. [Detected] Backend Engineer
   Company: BigTech Co
   ATS: Workday

---
Sent via Offlyn Extension"

# Check if target number provided
if [ -z "$1" ]; then
  echo "[FAIL] Error: Please provide your WhatsApp number"
  echo ""
  echo "Usage: $0 <whatsapp-number>"
  echo "Example: $0 '+15555550123'"
  echo ""
  echo "Note: Use E.164 format (country code + number, no spaces)"
  exit 1
fi

TARGET="$1"

echo "Testing WhatsApp summary sending..."
echo "Target: $TARGET"
echo ""
echo "Summary to send:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$TEST_SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Sending via OpenClaw..."
echo ""

# Send the message
openclaw message send \
  --channel whatsapp \
  --target "$TARGET" \
  --message "$TEST_SUMMARY"

if [ $? -eq 0 ]; then
  echo ""
  echo "[OK] Test summary sent successfully!"
  echo "Check your WhatsApp for the message"
else
  echo ""
  echo "[FAIL] Failed to send test summary"
  echo ""
  echo "Troubleshooting:"
  echo "1. Check OpenClaw gateway: openclaw gateway status"
  echo "2. Check WhatsApp link: openclaw channels list"
  echo "3. Verify target number format: +[country code][number]"
  exit 1
fi
