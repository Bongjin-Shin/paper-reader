#![cfg(target_os = "linux")]
use paper_vocabulary_lib::uninstall::register_data_paths;
use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
};

#[test]
fn registers_all_custom_locations_without_overwriting_previous_ones() {
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().join("home");
    let first = directory
        .path()
        .join("custom data/com.papervocabulary.reader");
    let second = directory.path().join("new data/com.papervocabulary.reader");
    register_data_paths(&home, &[first.clone()]).unwrap();
    register_data_paths(&home, &[second.clone(), first.clone()]).unwrap();
    let registry = home.join(".local/share/com.papervocabulary.reader/uninstall-paths");
    let entries: Vec<_> = fs::read_dir(&registry)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(entries.len(), 2);
    let contents: Vec<_> = entries
        .iter()
        .map(|entry| fs::read_to_string(entry).unwrap())
        .collect();
    for path in [first, second] {
        assert!(contents.contains(&format!("{}\n", path.display())));
    }
    assert_eq!(
        fs::metadata(&entries[0]).unwrap().permissions().mode() & 0o777,
        0o600
    );
    // Re-registration must replace a malicious file symlink, not its destination.
    let original = directory.path().join("original.pdf");
    fs::write(&original, "keep").unwrap();
    let registered = contents[0].trim();
    fs::remove_file(&entries[0]).unwrap();
    symlink(&original, &entries[0]).unwrap();
    register_data_paths(&home, &[registered.into()]).unwrap();
    assert_eq!(fs::read_to_string(original).unwrap(), "keep");
    assert!(!entries[0].is_symlink());
}

#[test]
fn refuses_paths_that_could_escape_the_app_directory() {
    let directory = tempfile::tempdir().unwrap();
    for path in [
        "/tmp/original-pdfs",
        "/tmp/../com.papervocabulary.reader",
        "relative/com.papervocabulary.reader",
        "/tmp/new\nline/com.papervocabulary.reader",
    ] {
        assert!(
            register_data_paths(directory.path(), &[path.into()]).is_err(),
            "{path}"
        );
    }
}
