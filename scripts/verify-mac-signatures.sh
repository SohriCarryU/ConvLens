#!/usr/bin/env bash
set -euo pipefail
test "${CONVLENS_SIGNING_MODE:-}" = signed
test -n "${APPLE_TEAM_ID:-}"
arch="${1:?Expected x64 or arm64}"
case "$arch" in
  x64) mach_arch=x86_64; unpacked=release/mac ;;
  arm64) mach_arch=arm64; unpacked=release/mac-arm64 ;;
  *) exit 1 ;;
esac
version=$(node -p 'require("./package.json").version')
temporary=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/convlens-verify.XXXXXX")
mounted=false
cleanup() {
  if "$mounted"; then hdiutil detach "$temporary/mount"; fi
  rm -rf "$temporary"
}
trap cleanup EXIT

verify_app() {
  local app="$1" details identifier
  test -d "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
  details=$(codesign --display --verbose=4 "$app" 2>&1)
  printf '%s\n' "$details"
  printf '%s\n' "$details" | grep -Fx "TeamIdentifier=$APPLE_TEAM_ID"
  printf '%s\n' "$details" | grep -E '^Authority=Developer ID Application:'
  printf '%s\n' "$details" | grep -E '^CodeDirectory .*flags=.*runtime'
  identifier=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Contents/Info.plist")
  test "$identifier" = com.sohri.convlens
  test "$(lipo -archs "$app/Contents/MacOS/ConvLens")" = "$mach_arch"
  xcrun stapler validate "$app"
  spctl --assess --verbose=4 --type execute "$app"
}

# Check both distributable containers, not only the builder's staging directory.
verify_app "$unpacked/ConvLens.app"
ditto -x -k "release/ConvLens-$version-mac-$arch.zip" "$temporary/zip"
verify_app "$temporary/zip/ConvLens.app"
mkdir "$temporary/mount"
hdiutil attach "release/ConvLens-$version-mac-$arch.dmg" -readonly -nobrowse -mountpoint "$temporary/mount"
mounted=true
verify_app "$temporary/mount/ConvLens.app"
hdiutil detach "$temporary/mount"
mounted=false
