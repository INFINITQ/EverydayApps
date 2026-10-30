// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    folio_core::run(
        folio_core::AppSpec {
            name: "Folio Docs",
            file_types: &[
                folio_core::FileType { label: "Word document", extensions: &["docx", "docm"] },
                folio_core::FileType { label: "Word 97-2003 document (opens read-only)", extensions: &["doc"] },
            ],
        },
        tauri::generate_context!(),
    );
}
