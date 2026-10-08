#!/usr/bin/env python3
"""Stage a pinned official Linux Codex package, never the user's installation/data."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.153.4"
TARGET = "x86_64-unknown-linux-musl"
SHA256 = "a822187e1a2420c61c5926721bfbd878701ed95547c9bb0d4de4498a16ba1821"
URL = f"https://github.com/openai/codex/releases/download/rust-v{VERSION}/codex-package-{TARGET}.tar.gz"


def main():
    cache = ROOT / ".tools/ubuntu"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"codex-package-{VERSION}-{TARGET}.tar.gz"
    if not archive.exists():
        partial = archive.with_suffix(".download")
        print(f"Downloading official Codex {VERSION} for Linux x64...", flush=True)
        urllib.request.urlretrieve(URL, partial)
        partial.replace(archive)
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != SHA256:
            raise RuntimeError("Official Linux runtime archive checksum mismatch")
    destination = ROOT / "src-tauri/resources/ubuntu/codex"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        staged = Path(temporary)
        with tarfile.open(archive) as package:
            package.extractall(staged, filter="data")
        executable = staged / "bin/codex"
        with executable.open("rb") as stream:
            header = stream.read(20)
        if header[:5] != b"\x7fELF\x02" or header[18:20] != b"\x3e\x00":
            raise RuntimeError("Runtime is not a Linux x86-64 executable")
        manifest = json.loads((staged / "codex-package.json").read_text())
        if manifest["version"] != VERSION or manifest["target"] != TARGET:
            raise RuntimeError("Runtime package manifest mismatch")
        for name in ["LICENSE", "NOTICE"]:
            urllib.request.urlretrieve(
                f"https://raw.githubusercontent.com/openai/codex/rust-v{VERSION}/{name}",
                staged / name,
            )
        (staged / "distribution.json").write_text(json.dumps({
            "version": VERSION, "target": TARGET, "source": URL, "sha256": SHA256,
        }, indent=2) + "\n")
        # Only replace this generated directory, which contains public release files.
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(staged, destination)
    print(f"Official Ubuntu runtime verified and staged: {destination}")


if __name__ == "__main__":
    main()
