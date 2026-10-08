"""Exercise the actual DEB hooks against disposable homes, never this PC's data."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOOKS = ROOT / "packaging/ubuntu"
APP = "com.papervocabulary.reader"


class UninstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="paper-removal-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home with spaces"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = {**os.environ, "PATH": f"{self.bin}:/usr/bin:/bin"}
        self.tool("getent", f"#!/bin/sh\ncat '{self.root}/passwd'\n")
        (self.root / "passwd").write_text(f"test:x:{os.getuid()}:{os.getgid()}::{self.home}:/bin/sh\n")
        # Simulate dpkg's root -> user transition; tests already run unprivileged.
        # The remaining command executes the real, isolated cleanup script.
        self.tool("setpriv", '#!/bin/sh\ncase "$1:$2:$3" in --reuid=*:--regid=*:--clear-groups) ;; *) exit 90 ;; esac\nshift 3\nexec "$@"\n')
        self.tool("readlink", '#!/bin/sh\nexit 1\n')

    def tool(self, name, contents):
        path = self.bin / name
        path.write_text(contents)
        path.chmod(0o755)

    def hook(self, name, action):
        return subprocess.run(["/bin/sh", str(HOOKS / name), action], env=self.env, capture_output=True, text=True)

    def seed(self, home=None):
        home = home or self.home
        paths = [home / part / APP for part in [".local/share", ".config", ".cache"]]
        for path in paths:
            path.mkdir(parents=True)
            (path / "private-data").write_text("fixture only")
        return paths

    def test_remove_and_purge_delete_only_app_data_and_are_repeatable(self):
        for action in ["remove", "purge"]:
            with self.subTest(action=action):
                paths = self.seed()
                original = self.home / "original.pdf"
                original.write_text("keep")
                other = self.home / ".local/share/another-app"
                other.mkdir(exist_ok=True)
                (other / "keep").write_text("keep")
                (paths[0] / "linked-original").symlink_to(other, target_is_directory=True)
                self.assertEqual(self.hook("postrm", action).returncode, 0)
                self.assertTrue(all(not path.exists() for path in paths))
                self.assertEqual(original.read_text(), "keep")
                self.assertTrue((other / "keep").exists())
                self.assertEqual(self.hook("postrm", action).returncode, 0)

    def test_upgrade_failure_and_abort_actions_preserve_data(self):
        paths = self.seed()
        self.tool("getent", "#!/bin/sh\nexit 99\n")
        for name in ["prerm", "postrm"]:
            for action in ["upgrade", "failed-upgrade", "abort-install", "abort-upgrade", "disappear", ""]:
                self.assertEqual(self.hook(name, action).returncode, 0, (name, action))
                self.assertTrue(all((path / "private-data").exists() for path in paths))

    def test_custom_locations_all_accounts_and_symlink_boundary(self):
        paths = self.seed()
        other_home = self.root / "second user"
        other_paths = self.seed(other_home)
        with (self.root / "passwd").open("a") as stream:
            stream.write(f"second:x:{os.getuid()}:{os.getgid()}::{other_home}:/bin/sh\n")
        custom = self.root / "external disk" / APP
        custom.mkdir(parents=True)
        (custom / "private").write_text("fixture")
        registry = paths[0] / "uninstall-paths"
        registry.mkdir()
        (registry / "custom").write_text(str(custom) + "\n")
        (registry / "default").write_text(str(paths[0]) + "\n")
        (registry / "incomplete.tmp").write_text("partial")
        # A leaf data-directory symlink is unlinked; the target is preserved.
        import shutil
        shutil.rmtree(paths[1])
        target = self.root / "original folder"
        target.mkdir()
        (target / "keep").write_text("original")
        paths[1].symlink_to(target, target_is_directory=True)
        result = self.hook("postrm", "remove")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(custom.exists())
        self.assertTrue(all(not path.exists() for path in paths + other_paths))
        self.assertEqual((target / "keep").read_text(), "original")

    def test_untrusted_registry_cannot_delete_arbitrary_paths(self):
        paths = self.seed()
        original = self.root / "originals"
        original.mkdir()
        (original / "keep").write_text("keep")
        registry = paths[0] / "uninstall-paths"
        registry.mkdir()
        for value in [str(original), str(original / "../com.papervocabulary.reader"), "/"]:
            (registry / "malicious").write_text(value + "\n")
            self.assertNotEqual(self.hook("postrm", "remove").returncode, 0)
            self.assertTrue((original / "keep").exists())
            self.assertTrue(registry.exists(), "Keep registry for retry after failure")

    def test_running_app_blocks_remove_but_not_upgrade(self):
        self.tool("readlink", "#!/bin/sh\nprintf '%s\\n' /usr/bin/paper-vocabulary\n")
        self.assertNotEqual(self.hook("prerm", "remove").returncode, 0)
        self.assertEqual(self.hook("prerm", "upgrade").returncode, 0)
        self.tool("readlink", "#!/bin/sh\nexit 1\n")
        self.assertEqual(self.hook("prerm", "remove").returncode, 0)


if __name__ == "__main__":
    unittest.main()
