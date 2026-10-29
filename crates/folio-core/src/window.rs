//! The main window: frameless, Mica Alt, hidden until the UI has painted.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::utils::WindowEffect;
use tauri::utils::config::WindowEffectsConfig;
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, DragDropEvent, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};

use crate::{AppSpec, Result, webview2};

pub const MAIN: &str = "main";

/// Runs before any page script: removes WebRTC and switches off DNS prefetching.
const INIT_SCRIPT: &str = include_str!("init.js");

static READY: AtomicBool = AtomicBool::new(false);

pub fn create_main(app: &AppHandle<Wry>, spec: AppSpec) -> Result<()> {
    // WebView2 adds its own `EBWebView` folder inside this one, like Tauri's default.
    let data_dir = crate::data_dir(app)?;
    std::fs::create_dir_all(&data_dir)?;
    let environment = webview2::create_environment(&data_dir)?;
    webview2::clear_crash_reports(&environment);

    // Settings and system colors are handed over before the page loads, so the very first
    // paint already has the right theme and accent.
    let boot = serde_json::json!({
        "settings": app.state::<crate::store::Settings>().get(),
        "system": crate::accent::current(),
    });

    let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title(spec.name)
        .inner_size(1200.0, 800.0)
        .min_inner_size(480.0, 360.0)
        .decorations(false)
        .transparent(true)
        .effects(WindowEffectsConfig {
            effects: vec![WindowEffect::Tabbed],
            ..Default::default()
        })
        .visible(false)
        .incognito(true)
        .general_autofill_enabled(false)
        .zoom_hotkeys_enabled(false)
        .initialization_script(INIT_SCRIPT)
        .initialization_script(format!("window.__FOLIO_BOOT__ = Object.freeze({boot});"))
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .on_download(|_webview, _event| false)
        .with_environment(environment)
        .build()?;

    webview2::harden(&window)?;
    crate::caption::install(&window)?;

    // Files dropped on the window are granted in Rust; the page only gets tokens. Minimized,
    // WebView2 is asked to use less memory; restored, it works normally again.
    let handle = app.clone();
    let watched = window.clone();
    let minimized = AtomicBool::new(false);
    window.on_window_event(move |event| match event {
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => crate::open::deliver(&handle, paths),
        WindowEvent::Resized(_) => {
            let now = watched.is_minimized().unwrap_or(false);
            if minimized.swap(now, Ordering::SeqCst) != now {
                webview2::set_low_memory(&watched, now);
            }
        }
        _ => {}
    });

    show_if_ui_hangs(window);
    Ok(())
}

/// Called by the UI once it has painted, so the window never flashes white.
pub fn mark_ready() {
    READY.store(true, Ordering::SeqCst);
}

/// If the UI never says it's ready (a crash or a bug), show the window anyway so the
/// app doesn't keep running invisibly.
fn show_if_ui_hangs(window: WebviewWindow<Wry>) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        if !READY.load(Ordering::SeqCst) && !crate::guard::background_mode() {
            let _ = window.show();
        }
    });
}
