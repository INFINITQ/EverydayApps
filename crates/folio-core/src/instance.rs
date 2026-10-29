//! One running copy per app: launching it again (say, double-clicking another PDF) hands the
//! files to the copy that's already running instead of opening a second one.
//!
//! A named mutex tells whether a copy is running. That copy owns a hidden message-only
//! window that receives the new launch's arguments through `WM_COPYDATA`. This is what
//! tauri-plugin-single-instance does on Windows, without its tokio `net` dependency
//! (see docs/adr/0001-no-network-crates.md).

use std::ffi::{OsString, c_void};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Wry};
use windows::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::COPYDATASTRUCT;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::UI::WindowsAndMessaging::{
    ASFW_ANY, AllowSetForegroundWindow, CreateWindowExW, DefWindowProcW, FindWindowExW, HWND_MESSAGE,
    RegisterClassW, SendMessageW, WINDOW_EX_STYLE, WINDOW_STYLE, WM_COPYDATA, WNDCLASSW,
};
use windows::core::{HSTRING, PCWSTR, w};

use crate::Result;

/// Marks our `WM_COPYDATA` messages ("FOLI").
const MAGIC: usize = 0x464F_4C49;

static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();

pub enum Launch {
    /// No other copy is running: start normally and listen for later launches.
    Primary(Primary),
    /// The files went to the copy that's already running: exit quietly.
    Forwarded,
}

pub struct Primary {
    class: HSTRING,
}

#[derive(Serialize, Deserialize)]
struct Handover {
    /// Arguments and folder as UTF-16, so unusual file names survive the trip intact.
    args: Vec<Vec<u16>>,
    cwd: Vec<u16>,
}

pub fn acquire(identifier: &str, args: &[OsString], cwd: &Path) -> Launch {
    let mutex_name = HSTRING::from(format!("Local\\{identifier}.instance"));
    let class = HSTRING::from(format!("FolioInstance:{identifier}"));
    // SAFETY: plain Win32 call. The handle is never closed: the mutex must live as long as
    // the process, and Windows releases it on exit.
    let created = unsafe { CreateMutexW(None, true, &mutex_name) };
    // SAFETY: reads the calling thread's last-error value.
    let already_running = created.is_ok() && unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    if !already_running {
        return Launch::Primary(Primary { class });
    }
    if forward(&class, args, cwd) {
        Launch::Forwarded
    } else {
        crate::guard::fatal("Folio is already running but isn't responding. Close it in Task Manager and try again.")
    }
}

/// Sends our arguments to the running copy, waiting up to 10 seconds for it to finish
/// starting.
fn forward(class: &HSTRING, args: &[OsString], cwd: &Path) -> bool {
    let handover = Handover {
        args: args.iter().map(|a| a.encode_wide().collect()).collect(),
        cwd: cwd.as_os_str().encode_wide().collect(),
    };
    let Ok(payload) = serde_json::to_vec(&handover) else { return false };
    for _ in 0..100 {
        // SAFETY: plain Win32 calls with valid arguments; `payload` outlives SendMessageW.
        unsafe {
            if let Ok(target) = FindWindowExW(Some(HWND_MESSAGE), None, class, PCWSTR::null()) {
                // Let the running copy bring its window to the front.
                let _ = AllowSetForegroundWindow(ASFW_ANY);
                let data = COPYDATASTRUCT {
                    dwData: MAGIC,
                    cbData: payload.len() as u32,
                    lpData: payload.as_ptr() as *mut c_void,
                };
                let handled = SendMessageW(target, WM_COPYDATA, None, Some(LPARAM(&raw const data as isize)));
                return handled.0 != 0;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

impl Primary {
    /// Creates the hidden window that later launches talk to. Call on the main thread.
    pub fn listen(&self, app: &AppHandle<Wry>) -> Result<()> {
        let _ = APP.set(app.clone());
        // SAFETY: plain Win32 calls on the main thread with valid arguments.
        unsafe {
            let instance = GetModuleHandleW(None)?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: instance.into(),
                lpszClassName: PCWSTR(self.class.as_ptr()),
                ..Default::default()
            };
            RegisterClassW(&class);
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                &self.class,
                w!(""),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(instance.into()),
                None,
            )?;
        }
        Ok(())
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_COPYDATA {
        // SAFETY: for WM_COPYDATA, lparam points at a COPYDATASTRUCT valid during this call.
        let data = unsafe { &*(lparam.0 as *const COPYDATASTRUCT) };
        if data.dwData == MAGIC && !data.lpData.is_null() {
            // SAFETY: the sender guarantees `cbData` readable bytes at `lpData`.
            let bytes = unsafe { std::slice::from_raw_parts(data.lpData as *const u8, data.cbData as usize) };
            if let (Ok(handover), Some(app)) = (serde_json::from_slice::<Handover>(bytes), APP.get()) {
                receive(app, handover);
            }
            return LRESULT(1);
        }
    }
    // SAFETY: default handling for everything else.
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn receive(app: &AppHandle<Wry>, handover: Handover) {
    let args: Vec<OsString> = handover.args.iter().map(|a| OsString::from_wide(a)).collect();
    let cwd = PathBuf::from(OsString::from_wide(&handover.cwd));
    crate::open::deliver(app, &crate::open::paths_from_args(&args, &cwd));
    if crate::guard::background_mode() {
        return;
    }
    if let Some(window) = app.get_webview_window(crate::window::MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        if window.set_focus().is_err() {
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }
}
