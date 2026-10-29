//! Files arriving from outside the UI: command-line arguments (double-click in Explorer,
//! "Open with"), a second launch of the app, and files dropped on the window.
//!
//! The UI subscribes to [`EVENT`] first and then calls `take_pending`, and calls it again on
//! every event, so no file is missed even if it arrives before the UI is ready.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::grants::{FileRef, Grants};

pub const EVENT: &str = "folio://open-files";

#[derive(Default)]
pub struct Pending(Mutex<Vec<FileRef>>);

impl Pending {
    pub fn take(&self) -> Vec<FileRef> {
        self.0.lock().map(|mut files| std::mem::take(&mut *files)).unwrap_or_default()
    }

    fn extend(&self, files: Vec<FileRef>) {
        if let Ok(mut pending) = self.0.lock() {
            pending.extend(files);
        }
    }
}

/// Command-line arguments to file paths: skips flags, resolves relative paths against the
/// launching program's folder, and keeps only files that exist.
pub fn paths_from_args(args: &[OsString], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .filter(|arg| !arg.to_string_lossy().starts_with('-'))
        .map(|arg| {
            let path = PathBuf::from(arg);
            if path.is_absolute() { path } else { cwd.join(path) }
        })
        .filter(|path| path.is_file())
        .collect()
}

/// Grants `paths` and hands them to the UI.
pub fn deliver(app: &AppHandle<Wry>, paths: &[PathBuf]) {
    if paths.is_empty() {
        return;
    }
    let grants = app.state::<Grants>();
    let files: Vec<FileRef> = paths.iter().filter_map(|path| grants.grant(path).ok()).collect();
    app.state::<Pending>().extend(files);
    let _ = app.emit_to(crate::window::MAIN, EVENT, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_become_existing_absolute_paths() {
        let dir = std::env::temp_dir().join(format!("folio-test-args-{}", crate::random::hex(4).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.pdf"), b"x").unwrap();
        let args: Vec<OsString> =
            ["a.pdf", "--flag", "missing.pdf"].iter().map(OsString::from).collect();
        assert_eq!(paths_from_args(&args, &dir), vec![dir.join("a.pdf")]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
