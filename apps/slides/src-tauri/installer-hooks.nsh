; Folio Slides' installer additions (config/installer-hooks.nsh): how it appears in Settings >
; Apps > Default apps. Keep the file types in step with bundle.fileAssociations in
; tauri.conf.json (config/installer-hooks.test.ts checks).
!define FOLIO_DESCRIPTION "Private, offline PowerPoint viewer and editor"

!macro FOLIO_FILE_TYPES
  !insertmacro FOLIO_FILE_TYPE "pptx" "Folio.PPTX"
  !insertmacro FOLIO_FILE_TYPE "pptm" "Folio.PPTM"
  !insertmacro FOLIO_FILE_TYPE "ppt" "Folio.PPT"
!macroend

!include "${__FILEDIR__}\..\..\..\config\installer-hooks.nsh"
