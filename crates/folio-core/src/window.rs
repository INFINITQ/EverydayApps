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
        // A slideshow's audience window never outlives the app's window.
        WindowEvent::Destroyed => {
            if let Some(audience) = handle.get_webview_window(AUDIENCE) {
                let _ = audience.destroy();
            }
        }
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

pub const AUDIENCE: &str = "audience";

/// Opens (or closes) the window a slideshow's audience sees, full screen on a monitor other
/// than the main window's. It shows the app's own page in its audience mode, hardened like
/// the main window, and gets no IPC permissions (no capability names it): the main window
/// sends it the slides over a same-origin BroadcastChannel. Returns false when there's no
/// second monitor (the show then stays in the main window).
pub fn audience(app: &AppHandle<Wry>, open: bool) -> Result<bool> {
    if let Some(existing) = app.get_webview_window(AUDIENCE) {
        if !open {
            existing.destroy()?;
            return Ok(false);
        }
        existing.set_focus()?;
        return Ok(true);
    }
    if !open || crate::guard::background_mode() {
        return Ok(false);
    }
    let Some(main) = app.get_webview_window(MAIN) else { return Ok(false) };
    let here = main.current_monitor()?.map(|m| (*m.position(), *m.size()));
    let Some(other) = app.available_monitors()?.into_iter().find(|m| Some((*m.position(), *m.size())) != here) else {
        return Ok(false);
    };
    let data_dir = crate::data_dir(app)?;
    let environment = webview2::create_environment(&data_dir)?;
    let position = other.position().to_logical::<f64>(other.scale_factor());
    let size = other.size().to_logical::<f64>(other.scale_factor());
    let window = WebviewWindowBuilder::new(app, AUDIENCE, WebviewUrl::App("index.html#audience".into()))
        .title("Slideshow")
        .position(position.x, position.y)
        .inner_size(size.width, size.height)
        .decorations(false)
        .fullscreen(true)
        .incognito(true)
        .general_autofill_enabled(false)
        .zoom_hotkeys_enabled(false)
        .initialization_script(INIT_SCRIPT)
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .on_download(|_webview, _event| false)
        .with_environment(environment)
        .build()?;
    webview2::harden(&window)?;
    Ok(true)
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
