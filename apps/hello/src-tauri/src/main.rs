// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    folio_core::run(
        folio_core::AppSpec {
            name: "Folio Hello",
            file_types: &[folio_core::FileType { label: "Text file", extensions: &["txt"] }],
        },
        tauri::generate_context!(),
    );
}
