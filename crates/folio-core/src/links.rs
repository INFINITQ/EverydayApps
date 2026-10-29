//! Opening web links from documents, in the user's own browser, after they confirmed in the
//! UI. Only `http`, `https` and `mailto` links: never files, programs or other protocols. Folio
//! itself makes no connection; Windows hands the address to the default browser or mail app.

use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{HSTRING, w};

use crate::{Error, Result};

/// A link that's safe to hand to Windows: a web or mail address, nothing else.
pub fn check(url: &str) -> Result<()> {
    let lower = url.to_ascii_lowercase();
    let web = ["http://", "https://"].iter().find_map(|scheme| lower.strip_prefix(scheme));
    let valid = url.len() <= 2048
        && !url.chars().any(|c| c.is_control() || c.is_whitespace() || c == '"')
        && match web {
            // A host must follow the scheme.
            Some(rest) => rest.split(['/', '?', '#']).next().is_some_and(|host| !host.is_empty()),
            None => lower.strip_prefix("mailto:").is_some_and(|address| !address.is_empty()),
        };
    if valid { Ok(()) } else { Err(Error::Invalid("Folio only opens web (http, https) and email links.".into())) }
}

pub fn open(url: &str) -> Result<()> {
    check(url)?;
    if let Some(log) = test_log() {
        // Debug builds only: end-to-end tests record the link instead of starting a browser.
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(log)?;
        writeln!(file, "{url}")?;
        return Ok(());
    }
    // SAFETY: plain Win32 call with valid, NUL-terminated strings.
    let result = unsafe { ShellExecuteW(None, w!("open"), &HSTRING::from(url), None, None, SW_SHOWNORMAL) };
    // Values above 32 mean success.
    if result.0 as isize > 32 { Ok(()) } else { Err(Error::Windows("Windows couldn't open the link.".into())) }
}

#[cfg(debug_assertions)]
fn test_log() -> Option<std::ffi::OsString> {
    std::env::var_os("FOLIO_TEST_LINKS").filter(|value| !value.is_empty())
}

#[cfg(not(debug_assertions))]
fn test_log() -> Option<std::ffi::OsString> {
    None
}

#[cfg(test)]
mod tests {
    use super::check;

    #[test]
    fn only_web_and_mail_links_pass() {
        for good in ["https://example.com", "http://example.com/a?b=c#d", "HTTPS://Example.com", "mailto:someone@example.com"] {
            assert!(check(good).is_ok(), "{good} should pass");
        }
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            "C:\\Windows\\notepad.exe",
            "ms-settings:privacy",
            "javascript:alert(1)",
            "https://",
            "https:///path",
            "https://example.com/a b",
            "https://example.com/\"x",
            "mailto:",
            "ftp://example.com",
        ] {
            assert!(check(bad).is_err(), "{bad} should be refused");
        }
    }
}
