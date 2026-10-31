; Folio Docs' installer additions (config/installer-hooks.nsh): how it appears in Settings >
; Apps > Default apps. Keep the file types in step with bundle.fileAssociations in
; tauri.conf.json (config/installer-hooks.test.ts checks).
!define FOLIO_DESCRIPTION "Private, offline Word document editor"

!macro FOLIO_FILE_TYPES
  !insertmacro FOLIO_FILE_TYPE "docx" "Folio.DOCX"
  !insertmacro FOLIO_FILE_TYPE "docm" "Folio.DOCM"
  !insertmacro FOLIO_FILE_TYPE "doc" "Folio.DOC"
!macroend

!include "${__FILEDIR__}\..\..\..\config\installer-hooks.nsh"
