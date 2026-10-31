//! Default apps: whether a double-click on the app's file types opens it, and a way to the
//! app's own page in Settings > Apps > Default apps.
//!
//! Folio never makes itself the default. Since Windows 8 that choice is the user's, made in
//! Windows' own settings and protected from other programs. Folio checks, and opens the page
//! where the user chooses. The installer lists each app there (config/installer-hooks.nsh);
//! see docs/adr/0013-default-apps.md.

use std::path::Path;

use serde::Serialize;
use windows::Win32::UI::Shell::{ASSOCSTR_EXECUTABLE, ASSOCSTR_FRIENDLYAPPNAME};

use crate::{Error, Result, explorer};

/// What a double-click on one of the app's file types opens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeDefault {
    /// The extension, without the dot ("pdf").
    pub ext: String,
    /// True when it opens this copy of the app.
    pub is_default: bool,
    /// The app it opens instead, as Windows names it ("Microsoft Edge"). None when it opens
    /// this app, or when no app is set and Windows would ask.
    pub app: Option<String>,
}

/// Checks each extension (without the dot) the way Explorer resolves a double-click.
pub fn status(extensions: Vec<String>) -> Vec<TypeDefault> {
    let this = std::env::current_exe().ok();
    explorer::on_com_thread(move || {
        extensions
            .into_iter()
            .map(|ext| {
                let assoc = format!(".{ext}");
                let opener = explorer::association(&assoc, ASSOCSTR_EXECUTABLE);
                let is_default = matches!((&this, &opener), (Some(this), Some(opener)) if same_file(this, Path::new(opener)));
                let app = match (&opener, is_default) {
                    (Some(_), false) => explorer::association(&assoc, ASSOCSTR_FRIENDLYAPPNAME),
                    _ => None,
                };
                TypeDefault { ext, is_default, app }
            })
            .collect()
    })
    .unwrap_or_default()
}

/// Whether two paths name the same file (they can differ in case or use short names).
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase(),
        _ => false,
    }
}

/// The app's page in Settings > Apps > Default apps. `name` is the app's entry under
/// HKCU\Software\RegisteredApplications, which the installer writes (its product name).
/// Windows 11 builds older than the April 2023 update open the list of apps instead.
pub fn settings_uri(name: &str) -> String {
    let escaped: String = name
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => char::from(b).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    format!("ms-settings:defaultapps?registeredAppUser={escaped}")
}

/// Opens the app's page in Settings, where the user can choose it for each file type.
pub fn open_settings(name: &str) -> Result<()> {
    if explorer::launch(&settings_uri(name))? { Ok(()) } else { Err(Error::Windows("Settings didn't open.".into())) }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn the_settings_page_is_for_the_registered_name() {
        assert_eq!(settings_uri("Folio PDF"), "ms-settings:defaultapps?registeredAppUser=Folio%20PDF");
        assert_eq!(settings_uri("A&B=C/é"), "ms-settings:defaultapps?registeredAppUser=A%26B%3DC%2F%C3%A9");
    }

    #[test]
    fn a_type_no_app_opens_is_not_this_one() {
        let ext = "folio-test-no-such-type".to_owned();
        assert_eq!(status(vec![ext.clone()]), vec![TypeDefault { ext, is_default: false, app: None }]);
    }

    #[test]
    fn the_same_file_matches_in_any_case() {
        let exe = std::env::current_exe().unwrap();
        assert!(same_file(&exe, &PathBuf::from(exe.to_string_lossy().to_uppercase())));
        assert!(!same_file(&exe, Path::new(r"C:\Windows\notepad.exe")));
        assert!(!same_file(&exe, Path::new(r"C:\folio-test\missing.exe")));
    }
}
