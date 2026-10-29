//! File-access grants.
//!
//! Only Rust creates a grant, and only for a file the user chose: picked in an Open or Save
//! dialog, dropped on the window, opened from Explorer, or reopened from recent files. The
//! UI receives an opaque token, never a path it could turn into access to another file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::{Error, Result, random};

/// Size and modification time of a file, used to notice changes made by other programs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub size: u64,
    pub modified_ms: u64,
}

impl Stamp {
    pub fn of(path: &Path) -> Result<Stamp> {
        let meta = std::fs::metadata(path)?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        Ok(Stamp { size: meta.len(), modified_ms })
    }
}

#[derive(Debug, Clone)]
pub struct Grant {
    pub path: PathBuf,
    /// Size and modification time when Folio last read or wrote the file.
    pub stamp: Option<Stamp>,
    /// Whether this session already backed up the original before overwriting it.
    pub backed_up: bool,
}

/// What the UI sees of a granted file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub token: String,
    pub name: String,
    /// Full path, for display only (tooltips, recent files). Never accepted back.
    pub display_path: String,
    pub size: u64,
    pub modified_ms: u64,
    pub exists: bool,
    pub read_only: bool,
    /// Stable id for this path (recent files, remembered view state). Not reversible.
    pub key: String,
}

#[derive(Default)]
pub struct Grants {
    inner: Mutex<HashMap<String, Grant>>,
}

impl Grants {
    /// Grants access to `path`, which may not exist yet (the target of "Save as").
    pub fn grant(&self, path: &Path) -> Result<FileRef> {
        let path = std::path::absolute(path)?;
        let meta = std::fs::metadata(&path).ok();
        let stamp = meta.as_ref().and_then(|_| Stamp::of(&path).ok());
        let token = random::hex(16)?;
        let file = FileRef {
            token: token.clone(),
            name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            display_path: path.to_string_lossy().into_owned(),
            size: stamp.map_or(0, |s| s.size),
            modified_ms: stamp.map_or(0, |s| s.modified_ms),
            exists: meta.is_some(),
            read_only: meta.as_ref().is_some_and(|m| m.permissions().readonly()),
            key: path_key(&path),
        };
        self.lock()?.insert(token, Grant { path, stamp: None, backed_up: false });
        Ok(file)
    }

    pub fn get(&self, token: &str) -> Result<Grant> {
        self.lock()?.get(token).cloned().ok_or(Error::UnknownToken)
    }

    pub fn update(&self, token: &str, change: impl FnOnce(&mut Grant)) -> Result<()> {
        let mut grants = self.lock()?;
        let grant = grants.get_mut(token).ok_or(Error::UnknownToken)?;
        change(grant);
        Ok(())
    }

    /// The UI closed the document: forget the grant.
    pub fn release(&self, token: &str) -> Result<()> {
        self.lock()?.remove(token);
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Grant>>> {
        self.inner.lock().map_err(|_| Error::Invalid("file grants are unavailable".into()))
    }
}

/// A stable, non-reversible id for a path (FNV-1a of the lower-cased path), used to
/// remember things per file without handing the UI another path-shaped value.
pub fn path_key(path: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_string_lossy().to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_unique_and_resolve() {
        let grants = Grants::default();
        let dir = std::env::temp_dir();
        let a = grants.grant(&dir.join("a.pdf")).unwrap();
        let b = grants.grant(&dir.join("a.pdf")).unwrap();
        assert_ne!(a.token, b.token);
        assert_eq!(a.key, b.key, "same path, same key");
        assert_eq!(grants.get(&a.token).unwrap().path, dir.join("a.pdf"));
    }

    #[test]
    fn unknown_and_released_tokens_are_rejected() {
        let grants = Grants::default();
        assert!(matches!(grants.get("nope"), Err(Error::UnknownToken)));
        let file = grants.grant(&std::env::temp_dir().join("b.pdf")).unwrap();
        grants.release(&file.token).unwrap();
        assert!(matches!(grants.get(&file.token), Err(Error::UnknownToken)));
    }

    #[test]
    fn keys_ignore_case() {
        assert_eq!(path_key(Path::new(r"C:\Docs\A.pdf")), path_key(Path::new(r"c:\docs\a.PDF")));
        assert_ne!(path_key(Path::new(r"C:\Docs\A.pdf")), path_key(Path::new(r"C:\Docs\B.pdf")));
    }
}
