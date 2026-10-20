#!/bin/bash
# Build the Gen UI widgets container app + WidgetKit extension.
# Needs full Xcode: install one via Xcodes.app, then
#   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
# Sign with your personal team (free): export DEVELOPMENT_TEAM=<team-id>
set -e
cd "$(dirname "$0")"
xcodegen
# A fresh build number every build — WidgetKit keys extension registration
# on (bundle id, build); without it the system keeps serving a stale appex.
xcodebuild -scheme GrokShellHost -configuration Debug -derivedDataPath build \
    CURRENT_PROJECT_VERSION="$(date +%Y%m%d%H%M)" \
    ${DEVELOPMENT_TEAM:+DEVELOPMENT_TEAM=$DEVELOPMENT_TEAM} \
    ${DEVELOPMENT_TEAM:-CODE_SIGN_IDENTITY=-} \
    -allowProvisioningUpdates build

# The gallery hides adhoc-signed extensions — re-sign both binaries with a
# real keychain dev cert when provisioning didn't already (Xcode account
# absent). CODESIGN_CERT overrides the identity name/hash.
if [ -z "$DEVELOPMENT_TEAM" ]; then
    CERT="${CODESIGN_CERT:-$(security find-identity -v -p codesigning \
        | awk '/Apple Development/{print $2; exit}')}" # hash, not name (dup certs are ambiguous)
    APP=build/Build/Products/Debug/GrokShellHost.app
    APPEX="$APP/Contents/PlugIns/GrokShellWidget.appex"
    [ -n "$CERT" ] && {
        codesign --force --sign "$CERT" \
            --entitlements GrokShellWidget/GrokShellWidget.entitlements \
            --timestamp=none "$APPEX"
        codesign --force --sign "$CERT" --timestamp=none "$APP"
        echo "Re-signed with: $CERT"
    }
fi
echo
echo "Built: native-widget/build/Build/Products/Debug/GrokShellHost.app"
echo "Next:  copy it to /Applications, run it once, then add the widget"
echo "       (Notification Center → Edit Widgets → Grok Shell Widgets)."
