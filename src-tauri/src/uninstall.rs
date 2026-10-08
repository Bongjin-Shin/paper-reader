//! Remember non-default Linux data locations for the DEB removal hook.
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::OpenOptionsExt,
    path::{Component, Path, PathBuf},
};

const APP_ID: &str = "com.papervocabulary.reader";

pub fn register_data_paths(home: &Path, paths: &[PathBuf]) -> io::Result<()> {
    let registry = home
        .join(".local/share")
        .join(APP_ID)
        .join("uninstall-paths");
    fs::create_dir_all(&registry)?;
    for path in paths {
        if !path.is_absolute()
            || path.file_name().and_then(|name| name.to_str()) != Some(APP_ID)
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(io::Error::other("Unsafe app data path"));
        }
        let normalized: PathBuf = path.components().collect();
        let value = normalized
            .to_str()
            .ok_or_else(|| io::Error::other("Invalid app data path"))?;
        if value.contains(['\n', '\r']) {
            return Err(io::Error::other("Invalid app data path"));
        }
        let name = format!("{:x}", Sha256::digest(value.as_bytes()));
        let destination = registry.join(&name);
        // Atomic replacement never follows a pre-existing registry-file symlink.
        let temporary = registry.join(format!("{name}.{}.tmp", std::process::id()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        let result = (|| {
            writeln!(file, "{value}")?;
            file.sync_all()?;
            fs::rename(&temporary, &destination)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
    }
    Ok(())
}
