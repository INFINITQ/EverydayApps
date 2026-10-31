# 0013. Default apps: each app is listed in Windows' Default apps and links there; Folio never sets the default

- Status: accepted
- Date: 2026-10-30

## Context

Double-clicking a file should open it in its Folio app. Tauri's installer registers each file
type (a ProgID such as `Folio.PDF`, set as the type's class), which is enough when the user
never chose another app for that type. Where they did (on the dev PC, Microsoft Edge for
`.pdf` and VS Code for `.csv`), Windows keeps that choice, and no program can change it: since
Windows 8 the choice is stored with a hash only Windows' own settings write, and recent
Windows 11 updates also guard it against other programs. Tools that forge it exist; they work
around a Windows protection, so Folio doesn't use them.

Settings > Apps > Default apps lists only apps that register their capabilities
(`RegisteredApplications`), which Tauri's installer doesn't, so the Folio apps couldn't be found
there by name. Since its April 2023 update, Windows 11 can open an app's own page there
(`ms-settings:defaultapps?registeredAppUser=<name>`).

## Decision

- The installer (`config/installer-hooks.nsh`, run through Tauri's NSIS hooks) registers each
  app per user: `HKCU\Software\Folio\<app>\Capabilities` with its name, description, icon and
  file types (each pointing at the ProgID Tauri registers), and
  `HKCU\Software\RegisteredApplications\<app>`. Uninstalling removes both.
  `config/installer-hooks.test.ts` keeps the listed types equal to `bundle.fileAssociations`.
- The app asks Windows what a double-click on each of its types opens (`AssocQueryStringW`, the
  user's choice first) and compares it with its own executable (`defaults.rs`). When its main
  type (`.pdf`, `.xlsx`, `.docx`, `.pptx`) opens another app, the start screen says so and
  offers "Set as default…", which opens the app's page in Settings, where the user chooses.
  "Don't show again" is remembered. The command palette always has "Set <app> as the default
  app…".
- Folio never writes the user's choice itself.

## Consequences

- A one-time step per file type that another app had claimed: the user picks the Folio app in
  Settings, or in File Explorer with Open with > Choose another app > Always.
- On Windows 11 builds without the April 2023 update, the button opens the Default apps list
  instead of the app's page.
- Debug test runs never open Settings: the page they would open is recorded in
  `FOLIO_TEST_LINKS`, and a hidden test run starts nothing.
- Tested: the Settings link and the association check in Rust, the offer in the shell's unit
  tests and end to end with Folio Hello, and the installer lists against each app's file types.
