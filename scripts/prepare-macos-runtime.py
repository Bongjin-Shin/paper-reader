#!/usr/bin/env python3
"""Stage a checksum-pinned official macOS Codex package, without user data."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import struct
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.153.4"
PACKAGES = {
    "aarch64-apple-darwin": "35438da1fbf7a6db7ddb3bcec84448fa6015ba188461472a97d9d1da7d9c4353",
    "x86_64-apple-darwin": "3ee638d7155c856ef31f3f4a85cb2195de1939962d3924c935b24f0514564a3d",
}


def native_target(system, machine):
    targets = {"arm64": "aarch64-apple-darwin", "x86_64": "x86_64-apple-darwin"}
    if system != "Darwin" or machine not in targets:
        raise ValueError("Use an Apple Silicon or Intel Mac to build this application")
    return targets[machine]


def stage_runtime(root, target):
    if target not in PACKAGES:
        raise ValueError(f"Unsupported macOS target: {target}")
    expected = PACKAGES[target]
    url = f"https://github.com/openai/codex/releases/download/rust-v{VERSION}/codex-package-{target}.tar.gz"
    cache = root / ".tools/macos"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"codex-package-{VERSION}-{target}.tar.gz"
    if not archive.exists():
        partial = archive.with_suffix(".download")
        print(f"Downloading official Codex {VERSION} for {target}...", flush=True)
        urllib.request.urlretrieve(url, partial)
        partial.replace(archive)
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
            raise ValueError(f"Runtime archive checksum mismatch; remove {archive} and download it again")

    destination = root / "src-tauri/resources/macos/codex"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        staged = Path(temporary) / "package"
        staged.mkdir()
        with tarfile.open(archive) as package:
            package.extractall(staged, filter="data")
        executable = staged / "bin/codex"
        with executable.open("rb") as stream:
            header = stream.read(8)
        cpu = 0x0100000C if target == "aarch64-apple-darwin" else 0x01000007
        if len(header) != 8 or struct.unpack("<II", header) != (0xFEEDFACF, cpu):
            raise ValueError("Runtime Mach-O architecture mismatch")
        if not executable.stat().st_mode & 0o111:
            raise ValueError("Runtime Mach-O executable permission is missing")
        manifest = json.loads((staged / "codex-package.json").read_text())
        if manifest.get("version") != VERSION or manifest.get("target") != target:
            raise ValueError("Runtime package manifest mismatch")
        for name in ("LICENSE", "NOTICE"):
            urllib.request.urlretrieve(
                f"https://raw.githubusercontent.com/openai/codex/rust-v{VERSION}/{name}", staged / name
            )
        (staged / "distribution.json").write_text(json.dumps({
            "version": VERSION, "target": target, "source": url, "sha256": expected,
        }, indent=2) + "\n")
        # Only generated public release files live here; authentication is app-local.
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(staged, destination, symlinks=True)
    print(f"Official macOS runtime verified and staged: {destination}")


def main():
    if sys.version_info < (3, 12):
        raise SystemExit("Python 3.12 or newer is required for filtered archive extraction")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=PACKAGES, help="Rust host target used by the native build")
    args = parser.parse_args()
    stage_runtime(ROOT, args.target or native_target(platform.system(), platform.machine()))


if __name__ == "__main__":
    main()
