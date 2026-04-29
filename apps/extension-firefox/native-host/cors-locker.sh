#!/usr/bin/env bash
# Minimal native messaging host for CORS lockdown.
# Receives a JSON message via stdin (4-byte LE length header + body),
# updates OLLAMA_ORIGINS, restarts Ollama, and responds.

LOG="/tmp/offlyn-cors-locker.log"
echo "$(date -u +%FT%TZ) === cors-locker started ===" >> "$LOG"

# Read 4-byte little-endian length from stdin
read_length() {
  local bytes
  bytes=$(dd bs=1 count=4 2>/dev/null | xxd -p)
  # Convert LE hex to decimal
  local b0=${bytes:0:2} b1=${bytes:2:2} b2=${bytes:4:2} b3=${bytes:6:2}
  printf '%d' "0x${b3}${b2}${b1}${b0}" 2>/dev/null || echo 0
}

# Send native messaging response
send_response() {
  local json="$1"
  local len=${#json}
  # Write 4-byte LE length header
  printf "\\x$(printf '%02x' $((len & 0xFF)))\\x$(printf '%02x' $(((len >> 8) & 0xFF)))\\x$(printf '%02x' $(((len >> 16) & 0xFF)))\\x$(printf '%02x' $(((len >> 24) & 0xFF)))"
  printf '%s' "$json"
}

# Read the incoming message
MSG_LEN=$(read_length)
echo "$(date -u +%FT%TZ) msg_len=$MSG_LEN" >> "$LOG"

if [ "$MSG_LEN" -gt 0 ] 2>/dev/null; then
  MSG=$(dd bs=1 count="$MSG_LEN" 2>/dev/null)
  echo "$(date -u +%FT%TZ) msg=$MSG" >> "$LOG"
else
  echo "$(date -u +%FT%TZ) ERROR: invalid length" >> "$LOG"
  send_response '{"type":"error","message":"invalid message"}'
  exit 1
fi

# Extract cmd and uuid using basic string parsing
CMD=$(echo "$MSG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cmd',''))" 2>/dev/null)
UUID=$(echo "$MSG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('uuid',''))" 2>/dev/null)
echo "$(date -u +%FT%TZ) cmd=$CMD uuid=$UUID" >> "$LOG"

if [ "$CMD" = "ping" ]; then
  send_response '{"type":"pong","version":"0.9.0"}'
  exit 0
fi

if [ "$CMD" = "lock_cors" ] && [ -n "$UUID" ]; then
  ORIGIN="moz-extension://$UUID"
  echo "$(date -u +%FT%TZ) Locking OLLAMA_ORIGINS to $ORIGIN" >> "$LOG"

  # Update launchctl env
  launchctl setenv OLLAMA_ORIGINS "$ORIGIN" 2>/dev/null

  # Update plist if present
  PLIST="$HOME/Library/LaunchAgents/com.ollama.ollama.plist"
  if [ -f "$PLIST" ]; then
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" "$PLIST" 2>/dev/null
    /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:OLLAMA_ORIGINS '$ORIGIN'" "$PLIST" 2>/dev/null \
      || /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:OLLAMA_ORIGINS string '$ORIGIN'" "$PLIST" 2>/dev/null
    echo "$(date -u +%FT%TZ) plist updated" >> "$LOG"
  fi

  # Restart Ollama with locked-down origin
  pkill -f "ollama serve" 2>/dev/null
  sleep 1
  OLLAMA_ORIGINS="$ORIGIN" /Applications/Ollama.app/Contents/Resources/ollama serve &>/dev/null &
  sleep 2

  echo "$(date -u +%FT%TZ) Ollama restarted with $ORIGIN" >> "$LOG"
  send_response "{\"type\":\"cors_locked\",\"origin\":\"$ORIGIN\"}"
  exit 0
fi

send_response '{"type":"error","message":"unknown command"}'
exit 1
