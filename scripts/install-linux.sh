#!/usr/bin/env bash
# Register the built app for this user; no root access or database migration required.
set -euo pipefail
project_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
app_version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$project_dir/src-tauri/tauri.conf.json")
app_image="$project_dir/src-tauri/target/release/bundle/appimage/Paper Vocabulary_${app_version}_amd64.AppImage"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
app_dir="$data_dir/paper-vocabulary-app"
desktop_dir="${PAPER_VOCABULARY_DESKTOP_DIR:-$(xdg-user-dir DESKTOP)}"
applications_dir="$data_dir/applications"
app_config_dir="$data_dir/com.papervocabulary.reader/PaperVocabulary"

if [[ ! -f "$app_image" ]]; then
  echo '먼저 Tauri AppImage를 빌드해 주세요.' >&2
  exit 1
fi
mkdir -p "$app_dir" "$applications_dir" "$desktop_dir"
# Pin a private copy of the installed official runtime. Authentication remains in
# the app's own ChatGPT directory; never copy Codex credentials or configuration.
codex_source=$(command -v codex || true)
# An app update must not fail while overwriting an existing read-only helper bundle.
# Keep the working private runtime; helper repair/update is managed separately.
if [[ -n "$codex_source" && ! -x "$app_config_dir/runtime/codex" ]]; then
  codex_source=$(readlink -f -- "$codex_source")
  if [[ $(file -b -- "$codex_source") == ELF* ]]; then
    mkdir -p "$app_config_dir/runtime/bin"
    install -m 755 "$codex_source" "$app_config_dir/runtime/bin/codex.new"
    mv -f "$app_config_dir/runtime/bin/codex.new" "$app_config_dir/runtime/bin/codex"
    ln -sfn bin/codex "$app_config_dir/runtime/codex"
    codex_package_dir=$(dirname -- "$(dirname -- "$codex_source")")
    if [[ -f "$codex_package_dir/codex-package.json" ]]; then
      install -m 644 "$codex_package_dir/codex-package.json" "$app_config_dir/runtime/codex-package.json"
      for resource in codex-resources codex-path; do
        if [[ -d "$codex_package_dir/$resource" ]]; then
          mkdir -p "$app_config_dir/runtime/$resource"
          cp -a -- "$codex_package_dir/$resource/." "$app_config_dir/runtime/$resource/"
        fi
      done
    fi
    "$app_config_dir/runtime/codex" --version > "$app_config_dir/runtime/version.txt"
  fi
fi
install -m 755 "$app_image" "$app_dir/PaperVocabulary.AppImage.new"
mv -f "$app_dir/PaperVocabulary.AppImage.new" "$app_dir/PaperVocabulary.AppImage"
install -m 644 "$project_dir/src-tauri/icons/128x128@2x.png" "$app_dir/icon.png"
cat > "$app_dir/launch.sh" <<'LAUNCH'
#!/bin/sh
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Extract-and-run works on systems without FUSE, including Ubuntu 24.04.
export APPIMAGE_EXTRACT_AND_RUN=1
exec "$app_dir/PaperVocabulary.AppImage" "$@"
LAUNCH
chmod 755 "$app_dir/launch.sh"

# Keep an existing installed configuration. If only development configuration
# exists, copy it locally without displaying its contents or including it in the bundle.
if [[ ! -e "$app_config_dir/.env" && -f "$project_dir/.env" ]]; then
  mkdir -p "$app_config_dir"
  (umask 077; cp -- "$project_dir/.env" "$app_config_dir/.env")
  chmod 600 "$app_config_dir/.env"
fi

# Escape paths according to the Desktop Entry string and Exec quoting rules.
export PAPER_VOCABULARY_APP_DIR="$app_dir" PAPER_VOCABULARY_APPLICATIONS_DIR="$applications_dir"
python3 - <<'PY'
import os
from pathlib import Path
app = Path(os.environ['PAPER_VOCABULARY_APP_DIR'])
def value(s):
    return str(s).replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\r')
def argument(s):
    s = str(s).replace('%', '%%')
    for char in ['\\', '"', '`', '$']:
        s = s.replace(char, '\\' + char)
    return value('"' + s + '"')
entry = '\n'.join([
    '[Desktop Entry]', 'Type=Application', 'Version=1.0', 'Name=Paper Vocabulary',
    'Comment=PDF Reader, Library and Vocabulary',
    'Comment[ko]=논문 읽기, 논문 보관과 단어장',
    'Exec=' + argument(app / 'launch.sh'), 'Icon=' + value(app / 'icon.png'),
    'Terminal=false', 'Categories=Education;', 'StartupNotify=true',
    'StartupWMClass=paper-vocabulary', '',
])
(Path(os.environ['PAPER_VOCABULARY_APPLICATIONS_DIR']) / 'com.papervocabulary.reader.desktop').write_text(entry)
PY
launcher="$applications_dir/com.papervocabulary.reader.desktop"
chmod 755 "$launcher"
install -m 755 "$launcher" "$desktop_dir/Paper Vocabulary.desktop"
if command -v desktop-file-validate >/dev/null; then desktop-file-validate "$launcher"; fi
if command -v update-desktop-database >/dev/null; then update-desktop-database "$applications_dir"; fi
if command -v gio >/dev/null; then
  gio set "$desktop_dir/Paper Vocabulary.desktop" metadata::trusted true 2>/dev/null || true
fi
echo "앱 설치 완료: $app_dir"
echo "바탕화면 바로가기: $desktop_dir/Paper Vocabulary.desktop"
