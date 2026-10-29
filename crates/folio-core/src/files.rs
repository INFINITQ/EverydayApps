//! Reading and saving granted files.
//!
//! Saving never corrupts the original: Folio writes a temporary file next to it, flushes it
//! to disk, then swaps it in with `ReplaceFileW`, which keeps the original's permissions,
//! creation time and alternate data streams (including Windows' "downloaded from the
//! internet" marker). Before the first overwrite in a session the original is backed up.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use windows::Win32::Storage::FileSystem::{
    MOVEFILE_WRITE_THROUGH, MoveFileExW, REPLACEFILE_IGNORE_ACL_ERRORS,
    REPLACEFILE_IGNORE_MERGE_ERRORS, REPLACEFILE_WRITE_THROUGH, ReplaceFileW,
};
use windows::core::{HSTRING, PCWSTR};

use crate::backups::Backups;
use crate::grants::{Grants, Stamp};
use crate::{Error, Result, random};

/// Reads a granted file and remembers its stamp for conflict detection.
pub fn read(grants: &Grants, token: &str) -> Result<Vec<u8>> {
    let grant = grants.get(token)?;
    let bytes = std::fs::read(&grant.path)?;
    let stamp = Stamp::of(&grant.path)?;
    grants.update(token, |g| g.stamp = Some(stamp))?;
    Ok(bytes)
}

/// Saves `bytes` to a granted file.
///
/// Fails with [`Error::Conflict`] if another program changed the file since Folio last read
/// or wrote it, unless `force` is set (the user chose "Overwrite").
pub fn save(grants: &Grants, backups: &Backups, token: &str, bytes: &[u8], force: bool) -> Result<Stamp> {
    let grant = grants.get(token)?;
    let path = &grant.path;
    if path.exists() {
        let current = Stamp::of(path)?;
        if let Some(expected) = grant.stamp
            && expected != current
            && !force
        {
            return Err(Error::Conflict);
        }
        if std::fs::metadata(path)?.permissions().readonly() {
            return Err(Error::ReadOnly);
        }
        if !grant.backed_up {
            backups.keep(path)?;
            grants.update(token, |g| g.backed_up = true)?;
        }
    }
    write_atomically(path, bytes)?;
    let stamp = Stamp::of(path)?;
    grants.update(token, |g| g.stamp = Some(stamp))?;
    Ok(stamp)
}

/// Writes `bytes` to `target` so that `target` is always either the old or the new file,
/// never a half-written one.
pub fn write_atomically(target: &Path, bytes: &[u8]) -> Result<()> {
    let dir = target.parent().ok_or_else(|| Error::Invalid("the file has no folder".into()))?;
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = dir.join(format!(".{name}.folio-{}.tmp", random::hex(4)?));
    let result = write_and_swap(target, &temp, bytes);
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Deletes the temporary files `write_atomically` leaves when the app is stopped mid-write,
/// in the app's own data folders (never in document folders: another program may be saving).
pub fn remove_stale_temps(dirs: &[&Path]) {
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let ours = name.starts_with('.') && name.contains(".folio-") && name.ends_with(".tmp");
            if ours && entry.file_type().is_ok_and(|kind| kind.is_file()) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

fn write_and_swap(target: &Path, temp: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);

    let target_w = HSTRING::from(target.as_os_str());
    let temp_w = HSTRING::from(temp.as_os_str());
    // SAFETY: valid, NUL-terminated paths; no optional pointers.
    unsafe {
        if target.exists() {
            ReplaceFileW(
                &target_w,
                &temp_w,
                PCWSTR::null(),
                REPLACEFILE_WRITE_THROUGH | REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS,
                None,
                None,
            )?;
        } else {
            MoveFileExW(&temp_w, &target_w, MOVEFILE_WRITE_THROUGH)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::PathBuf;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> TestDir {
            let dir = std::env::temp_dir().join(format!("folio-test-{name}-{}", random::hex(4).unwrap()));
            std::fs::create_dir_all(&dir).unwrap();
            TestDir(dir)
        }
        fn file(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, contents).unwrap();
            path
        }
        fn temp_files(&self) -> usize {
            std::fs::read_dir(&self.0)
                .unwrap()
                .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp"))
                .count()
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn setup(name: &str) -> (TestDir, Grants, Backups) {
        let dir = TestDir::new(name);
        let backups = Backups::new(dir.0.join("backups"));
        (dir, Grants::default(), backups)
    }

    #[test]
    fn clears_half_written_temp_files_only() {
        let dir = TestDir::new("stale");
        dir.file(".view-state.json.folio-1a2b3c4d.tmp", b"half");
        dir.file("view-state.json", b"{}");
        dir.file(".hidden.tmp", b"someone else's");
        dir.file("notes.folio-1.tmp", b"no leading dot: not ours");
        std::fs::create_dir(dir.0.join(".kept.folio-00000000.tmp")).unwrap();
        remove_stale_temps(&[&dir.0, &dir.0.join("missing")]);
        let mut left: Vec<String> =
            std::fs::read_dir(&dir.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, [".hidden.tmp", ".kept.folio-00000000.tmp", "notes.folio-1.tmp", "view-state.json"]);
    }

    #[test]
    fn saves_a_new_file() {
        let (dir, grants, backups) = setup("new");
        let file = grants.grant(&dir.0.join("new.pdf")).unwrap();
        assert!(!file.exists);
        save(&grants, &backups, &file.token, b"hello", false).unwrap();
        assert_eq!(std::fs::read(dir.0.join("new.pdf")).unwrap(), b"hello");
        assert_eq!(backups.usage().unwrap().0, 0, "nothing to back up for a new file");
    }

    #[test]
    fn overwrites_and_backs_up_once() {
        let (dir, grants, backups) = setup("overwrite");
        let path = dir.file("doc.pdf", b"original");
        let file = grants.grant(&path).unwrap();
        assert_eq!(read(&grants, &file.token).unwrap(), b"original");
        save(&grants, &backups, &file.token, b"first edit", false).unwrap();
        save(&grants, &backups, &file.token, b"second edit", false).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second edit");
        assert_eq!(backups.usage().unwrap().0, 1, "one backup per session");
        assert_eq!(dir.temp_files(), 0);
    }

    #[test]
    fn detects_changes_made_by_other_programs() {
        let (dir, grants, backups) = setup("conflict");
        let path = dir.file("doc.pdf", b"original");
        let file = grants.grant(&path).unwrap();
        read(&grants, &file.token).unwrap();
        std::fs::write(&path, b"changed elsewhere, and longer").unwrap();
        assert!(matches!(save(&grants, &backups, &file.token, b"mine", false), Err(Error::Conflict)));
        assert_eq!(std::fs::read(&path).unwrap(), b"changed elsewhere, and longer");
        save(&grants, &backups, &file.token, b"mine", true).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"mine");
    }

    #[test]
    fn refuses_read_only_files() {
        let (dir, grants, backups) = setup("readonly");
        let path = dir.file("doc.pdf", b"original");
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions.clone()).unwrap();
        let file = grants.grant(&path).unwrap();
        assert!(file.read_only);
        assert!(matches!(save(&grants, &backups, &file.token, b"x", false), Err(Error::ReadOnly)));
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(&path, permissions).unwrap();
    }

    #[test]
    fn locked_files_stay_intact() {
        let (dir, grants, backups) = setup("locked");
        let path = dir.file("doc.pdf", b"original");
        let file = grants.grant(&path).unwrap();
        // Another program holds the file open without sharing.
        let holder = OpenOptions::new().read(true).share_mode(0).open(&path).unwrap();
        let result = save(&grants, &backups, &file.token, b"new", false);
        assert!(matches!(result, Err(Error::Locked)), "got {result:?}");
        drop(holder);
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(dir.temp_files(), 0, "the temporary file is cleaned up");
    }

    #[test]
    fn unknown_tokens_are_rejected() {
        let (_dir, grants, backups) = setup("token");
        assert!(matches!(read(&grants, "missing"), Err(Error::UnknownToken)));
        assert!(matches!(save(&grants, &backups, "missing", b"x", false), Err(Error::UnknownToken)));
    }
}
