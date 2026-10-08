#!/usr/bin/env bash
# Build a Windows x64 NSIS installer from Linux; no personal data is packaged.
set -euo pipefail
project_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir"
if [[ -f .tools/env.sh ]]; then source .tools/env.sh; fi
if [[ -d .tools/windows/sysroot ]]; then
  # Tauri sets NSISDIR to the system path. Restore the project-local data path
  # inside the launcher so the extracted Ubuntu package works without root.
  mkdir -p .tools/windows/bin
  cat > .tools/windows/bin/makensis <<'NSIS'
#!/bin/sh
tool_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export NSISDIR="$tool_dir/sysroot/usr/share/nsis"
exec "$tool_dir/sysroot/usr/bin/makensis" "$@"
NSIS
  chmod 755 .tools/windows/bin/makensis
  export PATH="$project_dir/.tools/windows/bin:$project_dir/.tools/windows/python/bin:$project_dir/.tools/windows/sysroot/usr/lib/llvm-18/bin:$project_dir/.tools/windows/sysroot/usr/bin:$PATH"
  export NSISDIR="$project_dir/.tools/windows/sysroot/usr/share/nsis"
fi
export XWIN_CACHE_DIR="${XWIN_CACHE_DIR:-$project_dir/.tools/windows/xwin}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-8}"
python3 scripts/prepare-windows-runtime.py
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis -- --locked
