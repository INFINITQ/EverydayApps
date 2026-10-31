; Folio Sheets' installer additions (config/installer-hooks.nsh): how it appears in Settings >
; Apps > Default apps. Keep the file types in step with bundle.fileAssociations in
; tauri.conf.json (config/installer-hooks.test.ts checks).
!define FOLIO_DESCRIPTION "Private, offline spreadsheet editor"

!macro FOLIO_FILE_TYPES
  !insertmacro FOLIO_FILE_TYPE "xlsx" "Folio.XLSX"
  !insertmacro FOLIO_FILE_TYPE "xlsm" "Folio.XLSM"
  !insertmacro FOLIO_FILE_TYPE "csv" "Folio.CSV"
  !insertmacro FOLIO_FILE_TYPE "xls" "Folio.XLS"
!macroend

!include "${__FILEDIR__}\..\..\..\config\installer-hooks.nsh"
