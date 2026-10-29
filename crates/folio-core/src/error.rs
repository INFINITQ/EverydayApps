use serde::{Serialize, Serializer, ser::SerializeStruct};

/// Errors returned to the UI as `{ kind, message }`, so it can react to the kind
/// (for example offer "Save as" when a file is read-only).
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The file changed on disk since it was opened.")]
    Conflict,
    #[error("Another program is using this file.")]
    Locked,
    #[error("This file is read-only.")]
    ReadOnly,
    #[error("Windows denied access to this file.")]
    Denied,
    #[error("The disk is full.")]
    DiskFull,
    #[error("The file no longer exists.")]
    NotFound,
    #[error("This file is no longer open in Folio.")]
    UnknownToken,
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Unavailable(&'static str),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Io(std::io::Error),
    #[error("WebView2: {0}")]
    WebView2(String),
    #[error("Windows: {0}")]
    Windows(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl Error {
    /// Stable, machine-readable kind for the UI.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Conflict => "conflict",
            Error::Locked => "locked",
            Error::ReadOnly => "readOnly",
            Error::Denied => "denied",
            Error::DiskFull => "diskFull",
            Error::NotFound => "notFound",
            Error::UnknownToken => "unknownToken",
            Error::Invalid(_) => "invalid",
            Error::Unavailable(_) => "unavailable",
            Error::Tauri(_) => "tauri",
            Error::Io(_) => "io",
            Error::WebView2(_) => "webview2",
            Error::Windows(_) => "windows",
        }
    }

    /// Classifies a Win32 error code into the kinds the UI understands.
    pub fn from_win32(code: u32) -> Option<Error> {
        match code {
            2 | 3 => Some(Error::NotFound),        // ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND
            5 => Some(Error::Denied),              // ERROR_ACCESS_DENIED
            32 | 33 => Some(Error::Locked),        // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
            39 | 112 => Some(Error::DiskFull),     // ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL
            1175..=1177 => Some(Error::Locked),    // ERROR_UNABLE_TO_REMOVE_REPLACED / _MOVE_REPLACEMENT(_2)
            _ => None,
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        err.raw_os_error()
            .and_then(|code| Error::from_win32(code as u32))
            .unwrap_or(Error::Io(err))
    }
}

impl From<windows::core::Error> for Error {
    fn from(err: windows::core::Error) -> Self {
        let hresult = err.code().0 as u32;
        // HRESULT_FROM_WIN32: facility 7 (0x8007xxxx) carries a Win32 error code.
        if hresult & 0xFFFF_0000 == 0x8007_0000
            && let Some(kind) = Error::from_win32(hresult & 0xFFFF)
        {
            return kind;
        }
        Error::Windows(err.to_string())
    }
}

impl From<webview2_com::Error> for Error {
    fn from(err: webview2_com::Error) -> Self {
        Error::WebView2(format!("{err:?}"))
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("Error", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
