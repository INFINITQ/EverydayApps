//! Shared Rust core for the Folio apps.
//!
//! Each app's `main.rs` only describes itself and hands over to [`run`]:
//!
//! ```ignore
//! fn main() {
//!     folio_core::run(
//!         folio_core::AppSpec {
//!             name: "Folio PDF",
//!             file_types: &[folio_core::FileType { label: "PDF document", extensions: &["pdf"] }],
//!         },
//!         tauri::generate_context!(),
//!     );
//! }
//! ```

#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!("The `e2e` feature exposes test hooks and is only allowed in debug builds.");

#[cfg(not(windows))]
compile_error!("Folio targets Windows 11 only.");

mod accent;
mod backups;
mod caption;
mod commands;
mod dialogs;
mod error;
mod files;
mod folders;
mod grants;
mod guard;
mod instance;
mod links;
mod netlock;
mod open;
mod random;
mod recovery;
mod secure;
mod store;
mod webview2;
mod window;

use std::ffi::OsString;

use tauri::Manager;

pub use error::{Error, Result};

/// A kind of document an app opens.
#[derive(Debug, Clone, Copy)]
pub struct FileType {
    /// Shown in Open dialogs, e.g. "PDF document".
    pub label: &'static str,
    /// Extensions without the dot, e.g. `&["pdf"]`.
    pub extensions: &'static [&'static str],
}

/// What an app tells the shared core about itself.
#[derive(Debug, Clone, Copy)]
pub struct AppSpec {
    /// Display name, e.g. "Folio PDF".
    pub name: &'static str,
    /// Document types the app opens.
    pub file_types: &'static [FileType],
}

/// Version of the shared core, for diagnostics.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Runs a Folio app until it quits.
pub fn run(spec: AppSpec, context: tauri::Context<tauri::Wry>) {
    guard::scrub_webview2_environment();
    guard::require_release_security(&context);

    // Files passed on the command line (double-click in Explorer, "Open with").
    let launch_args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let launch_dir = std::env::current_dir().unwrap_or_default();

    // If this app is already running, hand it the files and quit. A test run is an instance of
    // its own, so it never hands files to the installed app (or gets them from it).
    let identifier = context.config().identifier.clone();
    let instance_name = match guard::test_data_dir() {
        Some(dir) => format!("{identifier}.test-{}", grants::path_key(&dir)),
        None => identifier.clone(),
    };
    let instance = match instance::acquire(&instance_name, &launch_args, &launch_dir) {
        instance::Launch::Primary(primary) => primary,
        instance::Launch::Forwarded => return,
    };

    let result = tauri::Builder::default()
        .plugin(plugin())
        .manage(spec)
        .manage(grants::Grants::default())
        .manage(folders::Folders::default())
        .manage(open::Pending::default())
        .setup(move |app| {
            let data = data_dir(app.handle())?;
            // Only this copy of the app writes here, so half-written files are from one stopped
            // mid-write.
            files::remove_stale_temps(&[&data, &data.join("recovery"), &data.join("secure")]);
            app.manage(backups::Backups::new(data.join("backups")));
            app.manage(store::Settings::open(data.join("settings.json")));
            let extensions: Vec<&str> = spec.file_types.iter().flat_map(|t| t.extensions.iter().copied()).collect();
            app.manage(store::Recent::open(data.join("recent.json"), &extensions));
            app.manage(store::ViewState::open(data.join("view-state.json")));
            app.manage(recovery::Recovery::new(data.join("recovery")));
            app.manage(secure::Secure::new(data.join("secure"), &identifier));
            match accent::watch(app.handle()) {
                Ok(watch) => {
                    app.manage(watch);
                }
                Err(err) => eprintln!("folio: won't follow accent color changes: {err}"),
            }
            instance.listen(app.handle())?;
            window::create_main(app.handle(), spec)?;
            open::deliver(app.handle(), &open::paths_from_args(&launch_args, &launch_dir));
            Ok(())
        })
        .run(context);

    if let Err(err) = result {
        guard::fatal(&format!("{} could not start.\n\n{err}", spec.name));
    }
}

/// Where the app keeps its data: %LOCALAPPDATA%\<identifier> (not roaming, removed on
/// uninstall), or a test run's own folder (see `guard::test_data_dir`).
fn data_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<std::path::PathBuf> {
    match guard::test_data_dir() {
        Some(dir) => Ok(dir),
        None => app.path().app_local_data_dir(),
    }
}

/// The internal `folio` plugin: every command the UI may call, plus the navigation guard.
fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("folio")
        .invoke_handler(tauri::generate_handler![
            commands::app_ready,
            commands::system_info,
            commands::pick_open,
            commands::pick_save,
            commands::read,
            commands::save,
            commands::release,
            commands::pick_folder,
            commands::save_into_folder,
            commands::release_folder,
            commands::open_link,
            commands::set_fullscreen,
            commands::presenter_screen,
            commands::take_pending,
            commands::backups_usage,
            commands::backups_clear,
            commands::settings_get,
            commands::settings_set,
            commands::recent_list,
            commands::recent_open,
            commands::recent_remove,
            commands::recent_clear,
            commands::view_state_get,
            commands::view_state_set,
            commands::recovery_put,
            commands::recovery_list,
            commands::recovery_read,
            commands::recovery_drop,
            commands::recovery_origin,
            commands::secure_put,
            commands::secure_get,
            commands::secure_delete,
            commands::secure_keys,
            commands::system,
            commands::network_lock,
            commands::caption_maximize_rect,
            commands::debug_crash_renderer,
        ])
        .on_navigation(|_webview, url| guard::allow_navigation(url))
        .build()
}
