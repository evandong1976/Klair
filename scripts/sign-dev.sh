#!/bin/sh
# Sign Klair.app with a stable local identity instead of an ad-hoc signature.
#
# macOS ties a privacy grant (Screen Recording, Input Monitoring) to the app's code
# signature. An ad-hoc signature changes on every build, so System Settings keeps
# showing Klair as allowed while the rebuilt app is refused. A self-signed
# certificate gives every build the same identity, so one grant keeps working.
#
# The certificate lives in its own keychain (not your login keychain) and is only
# good for signing local builds. To remove it:
#   security delete-keychain ~/Library/Keychains/klair-dev.keychain-db
set -eu

APP="${1:-dist/mac-arm64/Klair.app}"
NAME="Klair Dev"
KEYCHAIN="$HOME/Library/Keychains/klair-dev.keychain-db"
PASS="klair-dev" # guards a throwaway local signing key, nothing else

if [ ! -f "$KEYCHAIN" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$NAME" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
  /usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
    -name "$NAME" -out "$TMP/id.p12" -passout "pass:$PASS"
  security create-keychain -p "$PASS" "$KEYCHAIN"
  security set-keychain-settings "$KEYCHAIN" # no auto-lock timeout
  security import "$TMP/id.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple: -s -k "$PASS" "$KEYCHAIN" >/dev/null
  # codesign only finds identities in keychains on the search list.
  security list-keychains -d user -s $(security list-keychains -d user | tr -d '"') "$KEYCHAIN"
fi

security unlock-keychain -p "$PASS" "$KEYCHAIN"
codesign --force --deep --keychain "$KEYCHAIN" -s "$NAME" "$APP"
codesign -d -r- "$APP" 2>&1 | grep designated
