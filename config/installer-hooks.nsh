; Installer additions for every Folio app. Each app's src-tauri/installer-hooks.nsh defines
; FOLIO_DESCRIPTION and the FOLIO_FILE_TYPES macro, then includes this file. Tauri's NSIS
; template runs the NSIS_HOOK_* macros (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; They list the app in Settings > Apps > Default apps with the file types it opens, so Windows
; can show the app's own page there (the app's "Set as default" button opens it). Windows leaves
; the choice of default app to the user, so nothing here sets one. See
; docs/adr/0013-default-apps.md.

; One file type the app opens: its extension (no dot) and the ProgID Tauri registers for it.
!macro FOLIO_FILE_TYPE EXT PROGID
  WriteRegStr SHCTX "${MANUPRODUCTKEY}\Capabilities\FileAssociations" ".${EXT}" "${PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Start clean, so file types an older version listed don't linger.
  DeleteRegKey SHCTX "${MANUPRODUCTKEY}\Capabilities"
  WriteRegStr SHCTX "${MANUPRODUCTKEY}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${MANUPRODUCTKEY}\Capabilities" "ApplicationDescription" "${FOLIO_DESCRIPTION}"
  WriteRegStr SHCTX "${MANUPRODUCTKEY}\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  !insertmacro FOLIO_FILE_TYPES
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "${MANUPRODUCTKEY}\Capabilities"
  ; Tell Explorer and Settings that what apps can open has changed.
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey SHCTX "${MANUPRODUCTKEY}\Capabilities"
!macroend
