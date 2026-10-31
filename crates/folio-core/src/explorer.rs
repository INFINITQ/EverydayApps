//! What Explorer does with files: which app a double-click on a file type opens, and handing
//! Windows something to open (a web link, a Settings page) the way a click would.
//!
//! The shell expects COM on the calling thread (it may hand work to shell extensions there), so
//! these calls run on a short-lived thread with an apartment of its own, and the async
//! runtime's threads stay untouched.

use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize};
use windows::Win32::UI::Shell::{ASSOCF_INIT_IGNOREUNKNOWN, ASSOCSTR, AssocQueryStringW, ShellExecuteW};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{HSTRING, PWSTR, w};

use crate::Result;

/// Runs `work` on a new thread with COM set up. None if it panicked.
pub fn on_com_thread<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    std::thread::spawn(move || {
        // SAFETY: COM is set up and released on this thread only.
        let com = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
        let result = work();
        if com.is_ok() {
            // SAFETY: balances the successful CoInitializeEx above.
            unsafe { CoUninitialize() };
        }
        result
    })
    .join()
    .ok()
}

/// How Windows answers `what` for `assoc` (".pdf"), the user's own choice first, as for a
/// double-click in Explorer. None when no app is set for it. Call it from `on_com_thread`.
pub fn association(assoc: &str, what: ASSOCSTR) -> Option<String> {
    let assoc = HSTRING::from(assoc);
    let mut buffer = vec![0u16; 2048];
    let mut len = buffer.len() as u32;
    // Without IGNOREUNKNOWN, a type with no app answers with Windows' "pick an app" dialog.
    // SAFETY: plain Win32 call; `len` is the buffer's size in characters.
    let result = unsafe {
        AssocQueryStringW(ASSOCF_INIT_IGNOREUNKNOWN, what, &assoc, None, Some(PWSTR(buffer.as_mut_ptr())), &mut len)
    };
    if result.is_err() {
        return None;
    }
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    let text = String::from_utf16_lossy(&buffer[..end]);
    (!text.is_empty()).then_some(text)
}

/// Asks Windows to open `target` as a click would: a web or mail link in the default browser or
/// mail app, an `ms-settings:` page in Settings. Returns false if Windows couldn't. Debug test
/// runs write the target to `FOLIO_TEST_LINKS` instead, and a hidden test run never starts
/// anything.
pub fn launch(target: &str) -> Result<bool> {
    if let Some(log) = test_log() {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(log)?;
        writeln!(file, "{target}")?;
        return Ok(true);
    }
    if crate::guard::background_mode() {
        return Ok(true);
    }
    let target = HSTRING::from(target);
    let launched = on_com_thread(move || {
        // SAFETY: plain Win32 call with valid, NUL-terminated strings.
        let result = unsafe { ShellExecuteW(None, w!("open"), &target, None, None, SW_SHOWNORMAL) };
        // Values above 32 mean success.
        result.0 as isize > 32
    });
    Ok(launched.unwrap_or(false))
}

#[cfg(debug_assertions)]
fn test_log() -> Option<std::ffi::OsString> {
    std::env::var_os("FOLIO_TEST_LINKS").filter(|value| !value.is_empty())
}

#[cfg(not(debug_assertions))]
fn test_log() -> Option<std::ffi::OsString> {
    None
}
