//! Recovery snapshots of documents with unsaved changes. Offered back after a crash, deleted
//! when the document is saved or its changes are discarded. At most 1 GB in total.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::{Error, Result, files};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// The UI's id for the open document.
    pub doc: String,
    pub name: String,
    /// Where the document came from, if it was opened from a file.
    pub display_path: Option<String>,
    pub saved_ms: u64,
    pub size: u64,
}

pub struct Recovery {
    dir: PathBuf,
    max_bytes: u64,
}

impl Recovery {
    pub fn new(dir: PathBuf) -> Recovery {
        Recovery { dir, max_bytes: 1 << 30 }
    }

    pub fn put(&self, doc: &str, name: &str, origin: Option<PathBuf>, bytes: &[u8]) -> Result<()> {
        check_id(doc)?;
        std::fs::create_dir_all(&self.dir)?;
        files::write_atomically(&self.dir.join(format!("{doc}.bin")), bytes)?;
        let snapshot = Snapshot {
            doc: doc.to_owned(),
            name: name.to_owned(),
            display_path: origin.map(|p| p.to_string_lossy().into_owned()),
            saved_ms: SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64),
            size: bytes.len() as u64,
        };
        let meta = serde_json::to_vec(&snapshot).map_err(|e| Error::Invalid(e.to_string()))?;
        files::write_atomically(&self.dir.join(format!("{doc}.json")), &meta)?;
        self.prune()
    }

    pub fn list(&self) -> Result<Vec<Snapshot>> {
        let dir = match std::fs::read_dir(&self.dir) {
            Ok(dir) => dir,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.into()),
        };
        let mut snapshots = Vec::new();
        for entry in dir {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "json")
                && let Ok(bytes) = std::fs::read(&path)
                && let Ok(snapshot) = serde_json::from_slice::<Snapshot>(&bytes)
            {
                snapshots.push(snapshot);
            }
        }
        snapshots.sort_by_key(|s| std::cmp::Reverse(s.saved_ms));
        Ok(snapshots)
    }

    pub fn read(&self, doc: &str) -> Result<Vec<u8>> {
        check_id(doc)?;
        Ok(std::fs::read(self.dir.join(format!("{doc}.bin")))?)
    }

    pub fn origin(&self, doc: &str) -> Result<Option<PathBuf>> {
        Ok(self.list()?.into_iter().find(|s| s.doc == doc).and_then(|s| s.display_path).map(PathBuf::from))
    }

    pub fn drop_snapshot(&self, doc: &str) -> Result<()> {
        check_id(doc)?;
        for ext in ["bin", "json"] {
            match std::fs::remove_file(self.dir.join(format!("{doc}.{ext}"))) {
                Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(err.into()),
                _ => {}
            }
        }
        Ok(())
    }

    /// Oldest snapshots go first once the total passes the cap.
    fn prune(&self) -> Result<()> {
        let mut snapshots = self.list()?;
        let mut total: u64 = snapshots.iter().map(|s| s.size).sum();
        snapshots.sort_by_key(|s| s.saved_ms);
        for snapshot in snapshots {
            if total <= self.max_bytes {
                break;
            }
            total -= snapshot.size;
            self.drop_snapshot(&snapshot.doc)?;
        }
        Ok(())
    }
}

/// Document ids become file names, so only short, plain ids are accepted.
pub fn check_id(id: &str) -> Result<()> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid { Ok(()) } else { Err(Error::Invalid(format!("invalid id: {id:?}"))) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_round_trip_and_drop() {
        let dir = std::env::temp_dir().join(format!("folio-test-recovery-{}", crate::random::hex(4).unwrap()));
        let recovery = Recovery::new(dir.clone());
        recovery.put("doc-1", "Report.pdf", Some(PathBuf::from(r"C:\Docs\Report.pdf")), b"draft").unwrap();
        let list = recovery.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Report.pdf");
        assert_eq!(recovery.read("doc-1").unwrap(), b"draft");
        assert_eq!(recovery.origin("doc-1").unwrap(), Some(PathBuf::from(r"C:\Docs\Report.pdf")));
        recovery.drop_snapshot("doc-1").unwrap();
        assert!(recovery.list().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ids_cannot_escape_the_folder() {
        for bad in ["", "../x", r"..\x", "a/b", "C:", "x".repeat(65).as_str()] {
            assert!(check_id(bad).is_err(), "{bad:?} must be rejected");
        }
        assert!(check_id("doc_1-a").is_ok());
    }
}
