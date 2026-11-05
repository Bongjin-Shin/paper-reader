"""Verify macOS runtime staging with small, offline release-package fixtures."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts/prepare-macos-runtime.py"


class MacRuntime(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), "The portable macOS runtime stager is missing")
        spec = importlib.util.spec_from_file_location("macos_runtime", SCRIPT)
        self.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runtime)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def archive(self, target="aarch64-apple-darwin", cpu=0x0100000C, extra=None):
        data = {"bin/codex": struct.pack("<II", 0xFEEDFACF, cpu) + bytes(24),
                "codex-package.json": json.dumps({"version": self.runtime.VERSION, "target": target}).encode()}
        if extra:
            data.update(extra)
        archive = self.root / "fixture.tar.gz"
        with tarfile.open(archive, "w:gz") as package:
            for name, content in data.items():
                info = tarfile.TarInfo(name)
                info.size = len(content)
                info.mode = 0o755 if name == "bin/codex" else 0o644
                package.addfile(info, io.BytesIO(content))
        self.runtime.PACKAGES[target] = hashlib.sha256(archive.read_bytes()).hexdigest()
        return archive

    def stage(self, archive, target="aarch64-apple-darwin"):
        def fetch(url, destination):
            Path(destination).write_bytes(archive.read_bytes() if url.endswith(".tar.gz") else b"Public license notice\n")
        with patch.object(self.runtime.urllib.request, "urlretrieve", side_effect=fetch):
            self.runtime.stage_runtime(self.root, target)

    def previous(self):
        destination = self.root / "src-tauri/resources/macos/codex"
        destination.mkdir(parents=True)
        (destination / "keep").write_text("previous runtime")
        return destination

    def test_native_target_selection_rejects_unsupported_hosts(self):
        self.assertEqual(self.runtime.native_target("Darwin", "arm64"), "aarch64-apple-darwin")
        self.assertEqual(self.runtime.native_target("Darwin", "x86_64"), "x86_64-apple-darwin")
        for system, machine in [("Linux", "arm64"), ("Darwin", "armv7")]:
            with self.assertRaises(ValueError):
                self.runtime.native_target(system, machine)

    def test_stages_verified_arm64_package_and_public_metadata(self):
        self.stage(self.archive())
        destination = self.root / "src-tauri/resources/macos/codex"
        self.assertTrue((destination / "bin/codex").stat().st_mode & 0o111)
        self.assertEqual(json.loads((destination / "codex-package.json").read_text())["target"], "aarch64-apple-darwin")
        self.assertEqual(json.loads((destination / "distribution.json").read_text())["version"], self.runtime.VERSION)
        self.assertTrue((destination / "LICENSE").is_file())
        self.assertTrue((destination / "NOTICE").is_file())

    def test_stages_verified_intel_package(self):
        target = "x86_64-apple-darwin"
        self.stage(self.archive(target=target, cpu=0x01000007), target)
        manifest = self.root / "src-tauri/resources/macos/codex/codex-package.json"
        self.assertEqual(json.loads(manifest.read_text())["target"], target)

    def test_bad_checksum_preserves_previous_runtime(self):
        previous = self.previous()
        archive = self.archive()
        self.runtime.PACKAGES["aarch64-apple-darwin"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.stage(archive)
        self.assertEqual((previous / "keep").read_text(), "previous runtime")

    def test_wrong_manifest_preserves_previous_runtime(self):
        previous = self.previous()
        archive = self.archive(extra={"codex-package.json": b'{"version":"wrong","target":"aarch64-apple-darwin"}'})
        with self.assertRaisesRegex(ValueError, "manifest"):
            self.stage(archive)
        self.assertTrue((previous / "keep").is_file())

    def test_wrong_cpu_preserves_previous_runtime(self):
        previous = self.previous()
        with self.assertRaisesRegex(ValueError, "Mach-O"):
            self.stage(self.archive(cpu=0x01000007))
        self.assertTrue((previous / "keep").is_file())

    def test_archive_cannot_escape_the_staging_directory(self):
        previous = self.previous()
        with self.assertRaises(tarfile.FilterError):
            self.stage(self.archive(extra={"../../escaped": b"bad"}))
        self.assertFalse((self.root / "src-tauri/resources/escaped").exists())
        self.assertTrue((previous / "keep").is_file())


if __name__ == "__main__":
    unittest.main()
