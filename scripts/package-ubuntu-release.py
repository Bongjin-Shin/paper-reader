#!/usr/bin/env python3
"""Verify the DEB payload and place only shareable files in release/ubuntu."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["version"]
BUILD = ROOT / "src-tauri/target/release"
PACKAGE = BUILD / f"bundle/deb/Paper Vocabulary_{VERSION}_amd64.deb"
RUNTIME = ROOT / "src-tauri/resources/ubuntu/codex"


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    qa = ROOT / ".tools/ubuntu/qa"
    qa.mkdir(parents=True, exist_ok=True)
    control = subprocess.check_output(["dpkg-deb", "-f", str(PACKAGE)], text=True)
    for expected in ["Package: paper-vocabulary\n", f"Version: {VERSION}\n", "Architecture: amd64\n", "libc6 (>= 2.39)", "libwebkit2gtk-4.1-0", "libpoppler-glib8", "xdg-utils"]:
        assert expected in control, f"Missing package metadata: {expected}"
    # Inspect archive ownership/modes and reject any path outside the system prefix.
    proc = subprocess.Popen(["dpkg-deb", "--fsys-tarfile", str(PACKAGE)], stdout=subprocess.PIPE)
    with tarfile.open(fileobj=proc.stdout, mode="r|") as archive:
        for entry in archive:
            assert entry.uid == entry.gid == 0, "Package files must belong to root"
            assert not entry.mode & 0o6000, "Unexpected setuid/setgid file"
            assert entry.isdir() or entry.isfile(), "Unexpected link/device in package"
            assert ".." not in Path(entry.name).parts and not entry.name.startswith("/")
            assert Path(entry.name) == Path(".") or Path(entry.name).parts[0] == "usr"
    assert proc.wait() == 0, "Package archive failed to decompress"
    proc = subprocess.Popen(["dpkg-deb", "--ctrl-tarfile", str(PACKAGE)], stdout=subprocess.PIPE)
    hooks = {}
    with tarfile.open(fileobj=proc.stdout, mode="r|") as archive:
        for entry in archive:
            name = Path(entry.name).name
            if name in {"prerm", "postrm"}:
                assert entry.isfile() and entry.mode & 0o111, f"Non-executable hook: {name}"
                hooks[name] = archive.extractfile(entry).read()
    assert proc.wait() == 0, "Package control archive failed to decompress"
    for name in ["prerm", "postrm"]:
        assert hooks.get(name) == (ROOT / "packaging/ubuntu" / name).read_bytes(), f"Missing or stale removal hook: {name}"
    with tempfile.TemporaryDirectory(dir=qa) as temporary:
        extracted = Path(temporary)
        subprocess.run(["dpkg-deb", "-x", str(PACKAGE), str(extracted)], check=True)
        actual = {str(p.relative_to(extracted)) for p in extracted.rglob("*") if p.is_file()}
        runtime_files = {str(p.relative_to(RUNTIME)) for p in RUNTIME.rglob("*") if p.is_file()}
        prefix = "usr/lib/Paper Vocabulary/runtime/"
        other_files = {
            "usr/bin/paper-vocabulary", "usr/share/applications/Paper Vocabulary.desktop",
            "usr/share/doc/paper-vocabulary/README.ko.txt",
            *[f"usr/share/icons/hicolor/{size}/apps/paper-vocabulary.png" for size in ["32x32", "128x128", "256x256@2"]],
        }
        assert actual == {prefix + name for name in runtime_files} | other_files, "Unexpected payload file"
        for name in runtime_files:
            assert sha(RUNTIME / name) == sha(extracted / prefix / name), f"Runtime mismatch: {name}"
        binary = extracted / "usr/bin/paper-vocabulary"
        original = (BUILD / "paper-vocabulary").read_bytes()
        packaged = binary.read_bytes()
        assert len(original) == len(packaged), "App size differs from current build"
        if original != packaged:
            differences = [i for i, (a, b) in enumerate(zip(original, packaged)) if a != b]
            assert len(differences) == 3 and differences == list(range(differences[0], differences[0] + 3)), "Unexpected app changes"
            offset = differences[0]
            assert original[offset:offset + 3] == b"UNK" and packaged[offset:offset + 3] == b"DEB", "Unexpected Tauri bundle marker"
        assert not any(Path(name).suffix in [".db", ".pdf", ".log", ".jsonl", ".env"] for name in actual)
        desktop = extracted / "usr/share/applications/Paper Vocabulary.desktop"
        subprocess.run(["desktop-file-validate", str(desktop)], check=True)
        helper = extracted / prefix / "bin/codex"
        assert helper.stat().st_mode & 0o111, "Bundled runtime isn't executable"
        runtime_version = subprocess.check_output([str(helper), "--version"], text=True).strip()
        assert runtime_version == "codex-cli 0.153.4"
        app_hash = sha(binary)
    output = ROOT / "release/ubuntu"
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"PaperVocabulary-{VERSION}-Ubuntu-amd64.deb"
    stage = target.with_suffix(".deb.new")
    shutil.copy2(PACKAGE, stage)
    assert sha(stage) == sha(PACKAGE)
    stage.replace(target)
    shutil.copy2(ROOT / "packaging/ubuntu/설치안내.txt", output / "설치안내.txt")
    digest = sha(target)
    (output / "SHA256SUMS.txt").write_text(f"{digest}  {target.name}\n")
    report = {
        "artifact": str(target.relative_to(ROOT)), "builtAt": datetime.datetime.now(ZoneInfo("Asia/Seoul")).isoformat(timespec="seconds"),
        "sizeBytes": target.stat().st_size, "sha256": digest, "appSha256": app_hash,
        "version": VERSION, "architecture": "amd64", "minimumUbuntuVersion": "24.04",
        "codexVersion": "0.153.4", "claudeRuntimeBundled": False,
        "payloadAllowlist": "passed", "runtimeHashes": "passed", "rootOwnership": "passed",
        "desktopEntry": "passed", "removalHooks": "passed", "noUserDataPackaged": True, "files": sorted(actual),
    }
    (qa / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ["artifact", "sizeBytes", "sha256", "payloadAllowlist", "noUserDataPackaged"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
