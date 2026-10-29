// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    folio_core::run(
        folio_core::AppSpec {
            name: "Folio Sheets",
            file_types: &[
                folio_core::FileType { label: "Excel workbook", extensions: &["xlsx", "xlsm"] },
                folio_core::FileType { label: "CSV file", extensions: &["csv"] },
                folio_core::FileType { label: "Excel 97-2003 workbook", extensions: &["xls"] },
            ],
        },
        tauri::generate_context!(),
    );
}
