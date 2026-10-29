// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    folio_core::run(
        folio_core::AppSpec {
            name: "Folio PDF",
            file_types: &[folio_core::FileType { label: "PDF document", extensions: &["pdf"] }],
        },
        tauri::generate_context!(),
    );
}
