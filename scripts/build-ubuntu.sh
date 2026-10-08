#!/usr/bin/env bash
# Build a distributable amd64 DEB without reading/copying local application data.
set -euo pipefail
project_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir"
if [[ -f .tools/env.sh ]]; then source .tools/env.sh; fi
if [[ $(uname -m) != x86_64 ]]; then
  echo 'This package targets Intel/AMD 64-bit Ubuntu.' >&2
  exit 1
fi
python3 scripts/prepare-ubuntu-runtime.py
npm run tauri build -- --config src-tauri/tauri.ubuntu.conf.json --bundles deb -- --locked
python3 scripts/package-ubuntu-release.py
