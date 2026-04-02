#!/bin/bash
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.7.3}"
SIGNING_IDENTITY="Developer ID Installer: ANDESMAYA LLC (T8V4M25H2P)"
OUTPUT_UNSIGNED="$PROJ_DIR/offlyn-helper.pkg"
OUTPUT_SIGNED="$PROJ_DIR/offlyn-helper-signed.pkg"

STAGE=$(mktemp -d)
PKG_ROOT="$STAGE/root/.offlyn"
SCRIPTS="$STAGE/scripts"
mkdir -p "$PKG_ROOT" "$SCRIPTS"

cp "$PROJ_DIR/scripts/native-host/host.py" "$PKG_ROOT/helper.py"
cp "$PROJ_DIR/scripts/setup-ollama/setup-mac.sh" "$PKG_ROOT/setup-mac.sh"
chmod +x "$PKG_ROOT/helper.py" "$PKG_ROOT/setup-mac.sh"

cat > "$PKG_ROOT/helper.sh" << 'WRAPPER'
#!/bin/bash
exec python3 "$(dirname "$0")/helper.py" "$@"
WRAPPER
chmod +x "$PKG_ROOT/helper.sh"

cat > "$SCRIPTS/postinstall" << 'POSTINSTALL'
#!/bin/bash
CURRENT_USER=$(stat -f "%Su" /dev/console)
USER_HOME=$(eval echo "~$CURRENT_USER")
OFFLYN_DIR="$USER_HOME/.offlyn"

# The pkg installs to a fixed path (/Users/nishanthreddy/.offlyn) so we need to move files to the correct user home
PKG_INSTALL_DIR="/Users/nishanthreddy/.offlyn"
if [ "$OFFLYN_DIR" != "$PKG_INSTALL_DIR" ] && [ -d "$PKG_INSTALL_DIR" ]; then
  mkdir -p "$OFFLYN_DIR"
  cp -R "$PKG_INSTALL_DIR"/* "$OFFLYN_DIR"/
fi

chown -R "$CURRENT_USER:staff" "$OFFLYN_DIR"
chmod +x "$OFFLYN_DIR/helper.py" "$OFFLYN_DIR/helper.sh" "$OFFLYN_DIR/setup-mac.sh"

CHROME_DIR="$USER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
CHROMIUM_DIR="$USER_HOME/Library/Application Support/Chromium/NativeMessagingHosts"

# Collect Chrome extension IDs: published CWS ID + any unpacked Offlyn installs
CHROME_IDS="\"chrome-extension://elbohkpmfbjmcldfpeobpegcpcmcpdho/\""
for PROFILE_DIR in "$USER_HOME/Library/Application Support/Google/Chrome"/*/; do
  SECURE_PREFS="$PROFILE_DIR/Secure Preferences"
  [ -f "$SECURE_PREFS" ] || continue
  EXTRA_IDS=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for eid, info in data.get('extensions',{}).get('settings',{}).items():
    p = str(info.get('path',''))
    if 'offlyn' in p.lower() and eid != 'elbohkpmfbjmcldfpeobpegcpcmcpdho':
        print(eid)
" "$SECURE_PREFS" 2>/dev/null)
  for EID in $EXTRA_IDS; do
    CHROME_IDS="$CHROME_IDS, \"chrome-extension://$EID/\""
  done
done

MANIFEST="{
  \"name\": \"ai.offlyn.helper\",
  \"description\": \"Offlyn AI Setup Helper\",
  \"path\": \"$OFFLYN_DIR/helper.sh\",
  \"type\": \"stdio\",
  \"allowed_origins\": [$CHROME_IDS]
}"
for DIR in "$CHROME_DIR" "$CHROMIUM_DIR"; do
  mkdir -p "$DIR"
  chown "$CURRENT_USER:staff" "$DIR"
  echo "$MANIFEST" > "$DIR/ai.offlyn.helper.json"
  chown "$CURRENT_USER:staff" "$DIR/ai.offlyn.helper.json"
done

FIREFOX_DIR="$USER_HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
FIREFOX_MANIFEST="{
  \"name\": \"ai.offlyn.helper\",
  \"description\": \"Offlyn AI Setup Helper\",
  \"path\": \"$OFFLYN_DIR/helper.sh\",
  \"type\": \"stdio\",
  \"allowed_extensions\": [\"{e0857c2d-15a6-4d0c-935e-57761715dc3d}\"]
}"
mkdir -p "$FIREFOX_DIR"
chown "$CURRENT_USER:staff" "$FIREFOX_DIR"
echo "$FIREFOX_MANIFEST" > "$FIREFOX_DIR/ai.offlyn.helper.json"
chown "$CURRENT_USER:staff" "$FIREFOX_DIR/ai.offlyn.helper.json"

exit 0
POSTINSTALL
chmod +x "$SCRIPTS/postinstall"

echo "Building pkg v$VERSION..."
pkgbuild \
  --root "$STAGE/root" \
  --install-location "$HOME" \
  --scripts "$SCRIPTS" \
  --identifier "ai.offlyn.helper" \
  --version "$VERSION" \
  "$OUTPUT_UNSIGNED"

echo "Signing with: $SIGNING_IDENTITY"
productsign \
  --sign "$SIGNING_IDENTITY" \
  "$OUTPUT_UNSIGNED" \
  "$OUTPUT_SIGNED"

rm "$OUTPUT_UNSIGNED"
rm -rf "$STAGE"

echo ""
echo "Signed pkg: $OUTPUT_SIGNED"
echo ""
echo "To notarize and staple, run:"
echo "  xcrun notarytool submit $OUTPUT_SIGNED --apple-id <APPLE_ID> --team-id T8V4M25H2P --password <APP_SPECIFIC_PASSWORD> --wait"
echo "  xcrun stapler staple $OUTPUT_SIGNED"
