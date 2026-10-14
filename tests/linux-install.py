"""Exercise local in-place upgrades in an isolated XDG data directory."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class LocalInstall(unittest.TestCase):
    def test_upgrades_current_version_preserving_data_and_existing_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / "project"
            scripts = project / "scripts"
            scripts.mkdir(parents=True)
            shutil.copy2(ROOT / "scripts/install-linux.sh", scripts)
            icons = project / "src-tauri/icons"
            icons.mkdir(parents=True)
            (icons / "128x128@2x.png").write_bytes(b"icon")
            bundles = project / "src-tauri/target/release/bundle/appimage"
            bundles.mkdir(parents=True)
            data = root / "data"
            app_data = data / "com.papervocabulary.reader/PaperVocabulary"
            runtime = app_data / "runtime"
            runtime.mkdir(parents=True)
            helper = runtime / "codex"
            helper.write_text("#!/bin/sh\nexit 0\n")
            helper.chmod(0o555)
            saved = app_data / "database.db"
            saved.write_bytes(b"existing personal chat and notes")
            desktop = root / "desktop"
            bin_dir = root / "bin"
            bin_dir.mkdir()
            (bin_dir / "codex").symlink_to("/usr/bin/true")
            for name in ["gio", "desktop-file-validate", "update-desktop-database"]:
                command = bin_dir / name
                command.write_text("#!/bin/sh\nexit 0\n")
                command.chmod(0o755)
            env = dict(os.environ, XDG_DATA_HOME=str(data), PAPER_VOCABULARY_DESKTOP_DIR=str(desktop),
                       PATH=str(bin_dir) + os.pathsep + os.environ["PATH"])
            for version, contents in [("0.1.0", b"old application"), ("0.1.1", b"new application")]:
                (project / "src-tauri/tauri.conf.json").write_text(json.dumps({"version": version}))
                (bundles / f"Paper Vocabulary_{version}_amd64.AppImage").write_bytes(contents)
                subprocess.run(["bash", str(scripts / "install-linux.sh")], env=env, check=True, capture_output=True)
                self.assertEqual((data / "paper-vocabulary-app/PaperVocabulary.AppImage").read_bytes(), contents)
                self.assertEqual(saved.read_bytes(), b"existing personal chat and notes")
                self.assertEqual(helper.read_text(), "#!/bin/sh\nexit 0\n")
                self.assertTrue((desktop / "Paper Vocabulary.desktop").exists())


if __name__ == "__main__":
    unittest.main()
