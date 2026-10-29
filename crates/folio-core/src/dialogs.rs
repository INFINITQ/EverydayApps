//! Native Open and Save dialogs, shown from Rust so the UI never gets a file-system API.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::{WebviewWindow, Wry};

use crate::{AppSpec, Error, Result};

/// File types for an Open dialog that isn't for the app's own documents (pictures to insert,
/// for example).
#[derive(Debug, Clone, Deserialize)]
pub struct OpenFilter {
    pub label: String,
    pub extensions: Vec<String>,
}

impl OpenFilter {
    /// Extensions are short plain words ("png"), at most a dozen of them.
    pub fn check(&self) -> Result<()> {
        let valid = !self.extensions.is_empty()
            && self.extensions.len() <= 12
            && self.label.chars().count() <= 80
            && self.extensions.iter().all(|e| !e.is_empty() && e.len() <= 10 && e.chars().all(|c| c.is_ascii_alphanumeric()));
        if valid { Ok(()) } else { Err(Error::Invalid("invalid file types for the Open dialog".into())) }
    }
}

/// Debug builds only: end-to-end tests answer the dialogs through environment variables, so
/// no dialog ever appears on the desktop. `FOLIO_TEST_OPEN` lists the files to "pick"
/// (separated by `;`), `FOLIO_TEST_SAVE_DIR` is the folder Save "chooses". Compiled out of
/// release builds.
#[cfg(debug_assertions)]
fn test_answer(variable: &str) -> Option<OsString> {
    std::env::var_os(variable).filter(|value| !value.is_empty())
}

#[cfg(not(debug_assertions))]
fn test_answer(_variable: &str) -> Option<OsString> {
    None
}

/// Shows the Open dialog, filtered to `filter` or else to the app's file types.
pub fn pick_open(window: &WebviewWindow<Wry>, spec: &AppSpec, multiple: bool, filter: Option<&OpenFilter>) -> Vec<PathBuf> {
    if let Some(list) = test_answer("FOLIO_TEST_OPEN") {
        return std::env::split_paths(&list).take(if multiple { usize::MAX } else { 1 }).collect();
    }
    let mut dialog = rfd::FileDialog::new().set_parent(window);
    if let Some(filter) = filter {
        dialog = dialog.add_filter(&filter.label, &filter.extensions);
    } else {
        if spec.file_types.len() > 1 {
            let all: Vec<&str> = spec.file_types.iter().flat_map(|t| t.extensions.iter().copied()).collect();
            dialog = dialog.add_filter("All supported files", &all);
        }
        for file_type in spec.file_types {
            dialog = dialog.add_filter(file_type.label, file_type.extensions);
        }
    }
    if multiple {
        dialog.pick_files().unwrap_or_default()
    } else {
        dialog.pick_file().into_iter().collect()
    }
}

/// Shows the folder picker, for saving several new files.
pub fn pick_folder(window: &WebviewWindow<Wry>, title: &str) -> Option<PathBuf> {
    if let Some(dir) = test_answer("FOLIO_TEST_SAVE_DIR") {
        return Some(PathBuf::from(dir));
    }
    rfd::FileDialog::new().set_parent(window).set_title(title).pick_folder()
}

/// Shows the Save dialog for one file type.
pub fn pick_save(
    window: &WebviewWindow<Wry>,
    suggested_name: &str,
    label: &str,
    extension: &str,
) -> Option<PathBuf> {
    if let Some(dir) = test_answer("FOLIO_TEST_SAVE_DIR") {
        // Only the name part, so a test answer can't point outside the folder.
        let name = Path::new(suggested_name).file_name()?;
        return Some(PathBuf::from(dir).join(name));
    }
    let dialog = rfd::FileDialog::new().set_parent(window).set_file_name(suggested_name);
    // With no usable extension (an attachment called "README"), the dialog offers all files and
    // adds no extension of its own.
    match save_extension(extension) {
        Some(extension) => dialog.add_filter(label, &[extension]).save_file(),
        None => dialog.save_file(),
    }
}

/// A plain extension (letters and digits) for the Save dialog's filter, or none.
fn save_extension(extension: &str) -> Option<&str> {
    let ok = !extension.is_empty() && extension.len() <= 16 && extension.chars().all(|c| c.is_ascii_alphanumeric());
    ok.then_some(extension)
}

#[cfg(test)]
mod tests {
    use super::OpenFilter;

    fn filter(label: &str, extensions: &[&str]) -> OpenFilter {
        OpenFilter { label: label.into(), extensions: extensions.iter().map(|e| (*e).to_owned()).collect() }
    }

    #[test]
    fn save_filters_take_plain_extensions_only() {
        assert_eq!(super::save_extension("pdf"), Some("pdf"));
        assert_eq!(super::save_extension("xlsx"), Some("xlsx"));
        assert_eq!(super::save_extension(""), None);
        assert_eq!(super::save_extension("pdf;exe"), None);
        assert_eq!(super::save_extension("*"), None);
    }

    #[test]
    fn open_filters_take_plain_extensions_only() {
        assert!(filter("Pictures", &["png", "jpg", "jpeg"]).check().is_ok());
        assert!(filter("Pictures", &[]).check().is_err());
        assert!(filter("Pictures", &["*.png"]).check().is_err());
        assert!(filter("Pictures", &["png;exe"]).check().is_err());
        assert!(filter("Pictures", &["../x"]).check().is_err());
    }
}
