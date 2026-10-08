#!/usr/bin/env python3
"""Stage the pinned official Windows Codex package. Requires Python 3.12+."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.153.4"
ARCHIVE_SHA256 = "a6ef3442cb12766a88b39311d79244289e4f9763e2c53ff4fbebc2cb653cc5f3"
ARCHIVE_URL = (
    f"https://github.com/openai/codex/releases/download/rust-v{VERSION}/"
    "codex-package-x86_64-pc-windows-msvc.tar.gz"
)


def main():
    cache = ROOT / ".tools/windows"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"codex-package-{VERSION}.tar.gz"
    if not archive.exists():
        partial = archive.with_suffix(".download")
        print(f"Downloading official Codex {VERSION} for Windows x64...", flush=True)
        urllib.request.urlretrieve(ARCHIVE_URL, partial)
        partial.replace(archive)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != ARCHIVE_SHA256:
        raise RuntimeError(f"Codex archive checksum mismatch: {archive}")

    destination = ROOT / "src-tauri/resources/windows/codex"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        staged = Path(temporary)
        with tarfile.open(archive) as package:
            package.extractall(staged, filter="data")
        executable = staged / "bin/codex.exe"
        with executable.open("rb") as stream:
            if stream.read(2) != b"MZ":
                raise RuntimeError("The runtime is not a Windows executable")
        if not (staged / "codex-package.json").is_file():
            raise RuntimeError("The official runtime package manifest is missing")
        for name in ["LICENSE", "NOTICE"]:
            url = f"https://raw.githubusercontent.com/openai/codex/rust-v{VERSION}/{name}"
            urllib.request.urlretrieve(url, staged / name)
        (staged / "distribution.json").write_text(json.dumps({
            "version": VERSION,
            "target": "x86_64-pc-windows-msvc",
            "source": ARCHIVE_URL,
            "sha256": ARCHIVE_SHA256,
        }, indent=2) + "\n", encoding="utf-8")
        # This generated directory contains release binaries only, never user settings.
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(staged, destination)
    print(f"Windows runtime verified and staged: {destination}")


if __name__ == "__main__":
    main()
