//! Folder grants, for saving several new files at once (the parts of a split PDF).
//!
//! Like file grants, only Rust creates one, for a folder the user picked in a dialog. A folder
//! token can do exactly one thing: create *new* files directly in that folder. It can't read,
//! list or overwrite anything; a name that's taken gets " (2)", " (3)"... instead.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::{Error, Result, random};

/// What the UI sees of a granted folder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRef {
    pub token: String,
    pub name: String,
    /// For display only. Never accepted back.
    pub display_path: String,
}

#[derive(Default)]
pub struct Folders {
    inner: Mutex<HashMap<String, PathBuf>>,
}

impl Folders {
    pub fn grant(&self, dir: &Path) -> Result<FolderRef> {
        let dir = std::path::absolute(dir)?;
        if !dir.is_dir() {
            return Err(Error::NotFound);
        }
        let token = random::hex(16)?;
        let folder = FolderRef {
            token: token.clone(),
            name: dir.file_name().map_or_else(|| dir.to_string_lossy().into_owned(), |n| n.to_string_lossy().into_owned()),
            display_path: dir.to_string_lossy().into_owned(),
        };
        self.lock().insert(token, dir);
        Ok(folder)
    }

    pub fn release(&self, token: &str) {
        self.lock().remove(token);
    }

    /// Creates a new file called `name` (or "name (2)"...) in the folder; returns its name.
    pub fn save_new(&self, token: &str, name: &str, bytes: &[u8]) -> Result<String> {
        let dir = self.lock().get(token).cloned().ok_or(Error::UnknownToken)?;
        let name = clean_name(name)?;
        let (stem, ext) = match name.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() => (stem.to_owned(), format!(".{ext}")),
            _ => (name.to_owned(), String::new()),
        };
        for n in 1..1000 {
            let candidate = if n == 1 { name.to_owned() } else { format!("{stem} ({n}){ext}") };
            let path = dir.join(&candidate);
            let mut file = match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => file,
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err.into()),
            };
            let written = file.write_all(bytes).and_then(|()| file.sync_all());
            if let Err(err) = written {
                drop(file);
                let _ = std::fs::remove_file(&path);
                return Err(err.into());
            }
            return Ok(candidate);
        }
        Err(Error::Invalid(format!("too many files called {name} already")))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, PathBuf>> {
        self.inner.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// A plain Windows file name: no folders, no reserved characters or device names.
fn clean_name(name: &str) -> Result<&str> {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
        "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = name.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    let valid = !name.trim().is_empty()
        && name.chars().count() <= 200
        && !name.chars().any(|c| c.is_control() || r#"\/:*?"<>|"#.contains(c))
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !RESERVED.contains(&stem.as_str());
    if valid { Ok(name) } else { Err(Error::Invalid(format!("{name:?} can't be used as a file name"))) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("folio-test-folders-{}", random::hex(4).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_new_files_and_never_overwrites() {
        let dir = temp_dir();
        std::fs::write(dir.join("report (part 1).pdf"), b"theirs").unwrap();
        let folders = Folders::default();
        let folder = folders.grant(&dir).unwrap();

        let first = folders.save_new(&folder.token, "report (part 1).pdf", b"one").unwrap();
        let second = folders.save_new(&folder.token, "report (part 2).pdf", b"two").unwrap();
        assert_eq!(first, "report (part 1) (2).pdf");
        assert_eq!(second, "report (part 2).pdf");
        assert_eq!(std::fs::read(dir.join("report (part 1).pdf")).unwrap(), b"theirs");
        assert_eq!(std::fs::read(dir.join(&first)).unwrap(), b"one");

        folders.release(&folder.token);
        assert!(folders.save_new(&folder.token, "late.pdf", b"x").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_cannot_reach_outside_the_folder() {
        let dir = temp_dir();
        let folders = Folders::default();
        let folder = folders.grant(&dir).unwrap();
        for bad in ["..\\evil.pdf", "sub/evil.pdf", "C:evil.pdf", "CON.pdf", "nul", "", "  ", "trailing.", "a\u{1}.pdf"] {
            assert!(folders.save_new(&folder.token, bad, b"x").is_err(), "{bad:?} should be refused");
        }
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
