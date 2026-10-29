//! Commands the UI calls as `plugin:folio|<name>`.

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Runtime, State, WebviewWindow, Wry};

use crate::accent::SystemColors;
use crate::backups::Backups;
use crate::folders::{FolderRef, Folders};
use crate::grants::{FileRef, Grants, Stamp};
use crate::open::Pending;
use crate::recovery::{Recovery, Snapshot};
use crate::secure::Secure;
use crate::store::{Recent, RecentItem, Settings, ViewState};
use crate::{AppSpec, Error, Result, accent, dialogs, files, window};

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned)
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(Error::Invalid("expected raw bytes".into())),
    }
}

/// Header values are ASCII, so the UI percent-encodes names (`encodeURIComponent`).
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escaped = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], escaped) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The UI has painted: show the window.
#[tauri::command]
pub async fn app_ready<R: Runtime>(window: WebviewWindow<R>) -> Result<()> {
    window::mark_ready();
    if crate::guard::background_mode() {
        return Ok(());
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    app_name: &'static str,
    core_version: &'static str,
    debug: bool,
    webview2_version: String,
}

#[tauri::command]
pub async fn system_info(spec: State<'_, AppSpec>) -> Result<SystemInfo> {
    Ok(SystemInfo {
        app_name: spec.name,
        core_version: crate::version(),
        debug: cfg!(debug_assertions),
        webview2_version: tauri::webview_version().unwrap_or_default(),
    })
}

// --- Files -------------------------------------------------------------------------------

/// Shows the Open dialog, for the app's own file types or, with `filter`, for others (pictures
/// to insert). Every picked file comes back as a grant.
#[tauri::command]
pub async fn pick_open(
    window: WebviewWindow<Wry>,
    spec: State<'_, AppSpec>,
    grants: State<'_, Grants>,
    multiple: bool,
    filter: Option<dialogs::OpenFilter>,
) -> Result<Vec<FileRef>> {
    if let Some(filter) = &filter {
        filter.check()?;
    }
    let spec = *spec;
    let paths =
        tauri::async_runtime::spawn_blocking(move || dialogs::pick_open(&window, &spec, multiple, filter.as_ref()))
            .await
            .map_err(|e| Error::Invalid(format!("the Open dialog failed: {e}")))?;
    paths.iter().map(|path| grants.grant(path)).collect()
}

/// Shows the Save dialog. The chosen file comes back as a grant (it may not exist yet).
#[tauri::command]
pub async fn pick_save(
    window: WebviewWindow<Wry>,
    grants: State<'_, Grants>,
    suggested_name: String,
    label: String,
    extension: String,
) -> Result<Option<FileRef>> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        dialogs::pick_save(&window, &suggested_name, &label, &extension)
    })
    .await
    .map_err(|e| Error::Invalid(format!("the Save dialog failed: {e}")))?;
    path.map(|path| grants.grant(&path)).transpose()
}

/// Reads a granted file (and puts it at the top of recent files). The bytes travel as a raw
/// IPC response, with no JSON encoding.
#[tauri::command]
pub async fn read(grants: State<'_, Grants>, recent: State<'_, Recent>, token: String) -> Result<Response> {
    let bytes = files::read(&grants, &token)?;
    let _ = recent.touch(&grants.get(&token)?.path);
    Ok(Response::new(bytes))
}

/// Saves a granted file. The body is the raw file bytes; headers carry the token
/// (`x-folio-token`) and whether to overwrite changes made elsewhere (`x-folio-force: 1`).
#[tauri::command]
pub async fn save(
    grants: State<'_, Grants>,
    backups: State<'_, Backups>,
    recent: State<'_, Recent>,
    request: Request<'_>,
) -> Result<Stamp> {
    let token = header(&request, "x-folio-token").ok_or_else(|| Error::Invalid("missing file token".into()))?;
    let force = header(&request, "x-folio-force").as_deref() == Some("1");
    let stamp = files::save(&grants, &backups, &token, raw_body(&request)?, force)?;
    let _ = recent.touch(&grants.get(&token)?.path);
    Ok(stamp)
}

/// The document was closed: forget its grant.
#[tauri::command]
pub async fn release(grants: State<'_, Grants>, token: String) -> Result<()> {
    grants.release(&token)
}

/// Shows the folder picker. The folder comes back as a grant that can only create new files.
#[tauri::command]
pub async fn pick_folder(window: WebviewWindow<Wry>, folders: State<'_, Folders>, title: String) -> Result<Option<FolderRef>> {
    let title: String = title.chars().take(120).collect();
    let dir = tauri::async_runtime::spawn_blocking(move || dialogs::pick_folder(&window, &title))
        .await
        .map_err(|e| Error::Invalid(format!("the folder picker failed: {e}")))?;
    dir.map(|dir| folders.grant(&dir)).transpose()
}

/// Creates a new file in a granted folder. The body is the raw file bytes; headers carry the
/// folder token (`x-folio-token`) and the file name (`x-folio-name`, percent-encoded). Returns
/// the name actually used (" (2)" and so on when the name is taken; nothing is overwritten).
#[tauri::command]
pub async fn save_into_folder(folders: State<'_, Folders>, request: Request<'_>) -> Result<String> {
    let token = header(&request, "x-folio-token").ok_or(Error::UnknownToken)?;
    let name = header(&request, "x-folio-name").map(|n| percent_decode(&n)).unwrap_or_default();
    folders.save_new(&token, &name, raw_body(&request)?)
}

#[tauri::command]
pub async fn release_folder(folders: State<'_, Folders>, token: String) -> Result<()> {
    folders.release(&token);
    Ok(())
}

/// Opens a web or email link from a document in the default browser or mail app. The UI asks
/// first; only http, https and mailto links are accepted (see links.rs).
#[tauri::command]
pub async fn open_link(url: String) -> Result<()> {
    crate::links::open(&url)
}

/// Full screen on or off. A hidden test run (debug builds only) leaves its window alone:
/// leaving full screen restores the window's placement, which would show it.
#[tauri::command]
pub async fn set_fullscreen(window: WebviewWindow<Wry>, on: bool) -> Result<()> {
    if crate::guard::background_mode() {
        return Ok(());
    }
    window.set_fullscreen(on).map_err(|e| Error::Windows(format!("full screen failed: {e}")))
}

/// Opens or closes a slideshow's audience window on a second monitor (see
/// `window::audience`). Resolves true while it is open.
#[tauri::command]
pub async fn presenter_screen(app: AppHandle<Wry>, open: bool) -> Result<bool> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let handle = app.clone();
    // Windows are made on the main thread.
    app.run_on_main_thread(move || {
        let _ = sender.send(window::audience(&handle, open));
    })?;
    receiver.recv().map_err(|_| Error::Windows("the audience window couldn't be opened".into()))?
}

/// Files that arrived from Explorer, a second launch or a drop, since the last call.
#[tauri::command]
pub async fn take_pending(pending: State<'_, Pending>) -> Result<Vec<FileRef>> {
    Ok(pending.take())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    count: u64,
    bytes: u64,
}

#[tauri::command]
pub async fn backups_usage(backups: State<'_, Backups>) -> Result<Usage> {
    let (count, bytes) = backups.usage()?;
    Ok(Usage { count, bytes })
}

#[tauri::command]
pub async fn backups_clear(backups: State<'_, Backups>) -> Result<()> {
    backups.clear()
}

// --- Settings, recent files, view state -------------------------------------------------------

#[tauri::command]
pub async fn settings_get(settings: State<'_, Settings>) -> Result<Map<String, Value>> {
    Ok(settings.get())
}

/// Merges `patch` into the settings (`null` removes a key) and tells every window.
#[tauri::command]
pub async fn settings_set(
    app: AppHandle<Wry>,
    settings: State<'_, Settings>,
    patch: Map<String, Value>,
) -> Result<Map<String, Value>> {
    let merged = settings.merge(patch)?;
    let _ = app.emit_to(window::MAIN, "folio://settings", &merged);
    Ok(merged)
}

#[tauri::command]
pub async fn recent_list(recent: State<'_, Recent>) -> Result<Vec<RecentItem>> {
    Ok(recent.list())
}

/// Reopens a recent file: the path stays in Rust, the UI gets a fresh grant.
#[tauri::command]
pub async fn recent_open(recent: State<'_, Recent>, grants: State<'_, Grants>, key: String) -> Result<FileRef> {
    let path = recent.path_of(&key).filter(|p| p.is_file()).ok_or(Error::NotFound)?;
    grants.grant(&path)
}

#[tauri::command]
pub async fn recent_remove(recent: State<'_, Recent>, key: String) -> Result<()> {
    recent.remove(&key)
}

#[tauri::command]
pub async fn recent_clear(recent: State<'_, Recent>) -> Result<()> {
    recent.clear()
}

#[tauri::command]
pub async fn view_state_get(view: State<'_, ViewState>, key: String) -> Result<Option<Value>> {
    Ok(view.get(&key))
}

#[tauri::command]
pub async fn view_state_set(view: State<'_, ViewState>, key: String, value: Value) -> Result<()> {
    view.set(&key, value)
}

// --- Recovery snapshots ---------------------------------------------------------------------

/// Stores a recovery snapshot. Body: the document's bytes. Headers: `x-folio-doc` (the UI's
/// document id), `x-folio-name` (percent-encoded), optional `x-folio-token` (the file it
/// came from).
#[tauri::command]
pub async fn recovery_put(
    recovery: State<'_, Recovery>,
    grants: State<'_, Grants>,
    request: Request<'_>,
) -> Result<()> {
    let doc = header(&request, "x-folio-doc").ok_or_else(|| Error::Invalid("missing document id".into()))?;
    let name = header(&request, "x-folio-name").map(|n| percent_decode(&n)).unwrap_or_default();
    let origin = header(&request, "x-folio-token").and_then(|t| grants.get(&t).ok()).map(|g| g.path);
    recovery.put(&doc, &name, origin, raw_body(&request)?)
}

#[tauri::command]
pub async fn recovery_list(recovery: State<'_, Recovery>) -> Result<Vec<Snapshot>> {
    recovery.list()
}

#[tauri::command]
pub async fn recovery_read(recovery: State<'_, Recovery>, doc: String) -> Result<Response> {
    Ok(Response::new(recovery.read(&doc)?))
}

#[tauri::command]
pub async fn recovery_drop(recovery: State<'_, Recovery>, doc: String) -> Result<()> {
    recovery.drop_snapshot(&doc)
}

/// A grant for the file a snapshot came from, so a restored document can be saved back.
#[tauri::command]
pub async fn recovery_origin(
    recovery: State<'_, Recovery>,
    grants: State<'_, Grants>,
    doc: String,
) -> Result<Option<FileRef>> {
    recovery.origin(&doc)?.filter(|p| p.is_file()).map(|p| grants.grant(&p)).transpose()
}

// --- Encrypted store (saved signatures) ------------------------------------------------------

/// Body: the bytes to protect. Header `x-folio-key`: a short plain id.
#[tauri::command]
pub async fn secure_put(secure: State<'_, Secure>, request: Request<'_>) -> Result<()> {
    let key = header(&request, "x-folio-key").ok_or_else(|| Error::Invalid("missing key".into()))?;
    secure.put(&key, raw_body(&request)?)
}

#[tauri::command]
pub async fn secure_get(secure: State<'_, Secure>, key: String) -> Result<Response> {
    Ok(Response::new(secure.get(&key)?))
}

#[tauri::command]
pub async fn secure_delete(secure: State<'_, Secure>, key: String) -> Result<()> {
    secure.delete(&key)
}

#[tauri::command]
pub async fn secure_keys(secure: State<'_, Secure>) -> Result<Vec<String>> {
    secure.keys()
}

// --- System -----------------------------------------------------------------------------------

/// Windows' accent shades, light/dark, high contrast and transparency.
#[tauri::command]
pub async fn system() -> Result<SystemColors> {
    Ok(accent::current())
}

/// Whether Folio's private WebView2 is in use and blocked by Windows Firewall.
#[tauri::command]
pub async fn network_lock() -> Result<crate::netlock::NetworkLock> {
    Ok(crate::netlock::status())
}

// --- Window --------------------------------------------------------------------------------

/// The UI reports where its HTML maximize button is, so the Snap Layouts overlay can sit
/// exactly on top of it.
#[tauri::command]
pub async fn caption_maximize_rect(rect: crate::caption::ButtonRect) -> Result<()> {
    crate::caption::set_rect(rect);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn percent_decoding_handles_unicode_and_junk() {
        assert_eq!(super::percent_decode("Q3%20report%20%E2%80%93%20draft.pdf"), "Q3 report – draft.pdf");
        assert_eq!(super::percent_decode("100%"), "100%");
        assert_eq!(super::percent_decode("%zz"), "%zz");
    }
}

// --- Debug only ------------------------------------------------------------------------------

/// Debug builds only: crashes the page's renderer process, to check that crash dumps are
/// written locally and never uploaded. Not part of `folio:default`.
#[tauri::command]
pub async fn debug_crash_renderer<R: Runtime>(window: WebviewWindow<R>) -> Result<()> {
    if !cfg!(debug_assertions) {
        return Err(Error::Unavailable("debug_crash_renderer is only available in debug builds"));
    }
    window.with_webview(|webview| {
        use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
        use windows::core::w;
        // SAFETY: runs on the main thread with the live controller.
        unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
                let _ = core.CallDevToolsProtocolMethod(w!("Page.crash"), w!("{}"), &done);
            }
        }
    })?;
    Ok(())
}
