; Folio PDF's installer additions (config/installer-hooks.nsh): how it appears in Settings >
; Apps > Default apps. Keep the file types in step with bundle.fileAssociations in
; tauri.conf.json (config/installer-hooks.test.ts checks).
!define FOLIO_DESCRIPTION "Private, offline PDF viewer and editor"

!macro FOLIO_FILE_TYPES
  !insertmacro FOLIO_FILE_TYPE "pdf" "Folio.PDF"
!macroend

!include "${__FILEDIR__}\..\..\..\config\installer-hooks.nsh"
