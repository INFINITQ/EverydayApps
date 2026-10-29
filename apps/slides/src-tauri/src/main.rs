// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    folio_core::run(
        folio_core::AppSpec {
            name: "Folio Slides",
            file_types: &[
                folio_core::FileType { label: "PowerPoint presentation", extensions: &["pptx", "pptm"] },
                folio_core::FileType { label: "PowerPoint 97-2003 presentation", extensions: &["ppt"] },
            ],
        },
        tauri::generate_context!(),
    );
}
