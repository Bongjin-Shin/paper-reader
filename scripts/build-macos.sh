#!/usr/bin/env bash
# Build a local native macOS app with a pinned, private-data-free CLI runtime.
set -euo pipefail
project_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir"
if [[ $(uname -s) != Darwin ]]; then
  echo 'Run this script on macOS.' >&2
  exit 1
fi
for tool in node npm cargo rustc python3 xcrun codesign xattr; do
  command -v "$tool" >/dev/null || { echo "Missing build prerequisite: $tool" >&2; exit 1; }
done
xcrun --show-sdk-path >/dev/null
if [[ -n ${CARGO_BUILD_TARGET:-} ]]; then
  echo 'This script builds the native Rust host; unset CARGO_BUILD_TARGET first.' >&2
  exit 1
fi
if [[ -n ${APPLE_SIGNING_IDENTITY:-} && ${APPLE_SIGNING_IDENTITY} != - ]]; then
  echo 'This helper uses local ad-hoc signing; use the Tauri distribution-signing workflow for a Developer ID release.' >&2
  exit 1
fi
target=$(rustc -vV | sed -n 's/^host: //p')
python3 scripts/prepare-macos-runtime.py --target "$target"
npm run tauri build -- --config src-tauri/tauri.macos.conf.json --bundles app -- --locked
target_dir=$(cargo metadata --manifest-path src-tauri/Cargo.toml --locked --offline --no-deps --format-version 1 |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')
app="$target_dir/release/bundle/macos/Paper Vocabulary.app"
test -d "$app"
# Finder/iCloud metadata can prevent signing; keep provenance/quarantine intact.
xattr -dr com.apple.FinderInfo "$app"
xattr -dr com.apple.ResourceFork "$app"
# Preserve the official signatures/entitlements of the nested runtime binaries.
codesign --force --sign - --timestamp=none "$app"
codesign --verify --deep --strict "$app"
printf 'Local macOS app built and verified: %s\n' "$app"
