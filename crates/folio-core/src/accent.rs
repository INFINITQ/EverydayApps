//! Windows' accent color, light/dark mode, high contrast and transparency, kept live: the UI
//! gets a `folio://system` event whenever any of them changes.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Wry};
use windows::Foundation::TypedEventHandler;
use windows::UI::Color;
use windows::UI::ViewManagement::{UIColorType, UISettings};
use windows::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
use windows::Win32::UI::WindowsAndMessaging::{
    SPI_GETHIGHCONTRAST, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, SystemParametersInfoW,
};

use crate::Result;

pub const EVENT: &str = "folio://system";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemColors {
    /// Windows' accent shades, darkest to lightest:
    /// Dark3, Dark2, Dark1, Accent, Light1, Light2, Light3.
    pub accent: [String; 7],
    pub dark: bool,
    pub high_contrast: bool,
    /// Windows' "Transparency effects" setting. When off, the UI drops Mica.
    pub transparency: bool,
}

/// Keeps the `UISettings` object, and with it the change events, alive.
pub struct SystemWatch {
    _settings: UISettings,
}

fn hex(c: Color) -> String {
    format!("#{:02x}{:02x}{:02x}", c.R, c.G, c.B)
}

fn read(settings: &UISettings) -> SystemColors {
    let shade = |kind: UIColorType| settings.GetColorValue(kind).map(hex).unwrap_or_else(|_| "#0078d4".into());
    let background = settings.GetColorValue(UIColorType::Background).ok();
    SystemColors {
        accent: [
            UIColorType::AccentDark3,
            UIColorType::AccentDark2,
            UIColorType::AccentDark1,
            UIColorType::Accent,
            UIColorType::AccentLight1,
            UIColorType::AccentLight2,
            UIColorType::AccentLight3,
        ]
        .map(shade),
        dark: background.is_some_and(|c| u32::from(c.R) + u32::from(c.G) + u32::from(c.B) < 384),
        high_contrast: high_contrast(),
        transparency: settings.AdvancedEffectsEnabled().unwrap_or(true),
    }
}

/// The current system colors (Windows' default blue if they can't be read).
pub fn current() -> SystemColors {
    UISettings::new().map(|s| read(&s)).unwrap_or_else(|_| SystemColors {
        accent: ["#003e92", "#0049a4", "#005fb8", "#0078d4", "#3e9fe7", "#76b9ed", "#99ebff"].map(String::from),
        dark: false,
        high_contrast: high_contrast(),
        transparency: true,
    })
}

fn high_contrast() -> bool {
    let mut info = HIGHCONTRASTW { cbSize: size_of::<HIGHCONTRASTW>() as u32, ..Default::default() };
    // SAFETY: `info` is a correctly sized, writable HIGHCONTRASTW.
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            info.cbSize,
            Some((&raw mut info).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    }
    .is_ok();
    ok && info.dwFlags.contains(HCF_HIGHCONTRASTON)
}

/// Sends `folio://system` to the main window whenever Windows' colors or transparency change.
pub fn watch(app: &AppHandle<Wry>) -> Result<SystemWatch> {
    let settings = UISettings::new()?;
    let emit = {
        let app = app.clone();
        let settings = settings.clone();
        move || {
            let _ = app.emit_to(crate::window::MAIN, EVENT, read(&settings));
        }
    };
    let on_colors = emit.clone();
    settings.ColorValuesChanged(&TypedEventHandler::new(move |_, _| {
        on_colors();
        Ok(())
    }))?;
    settings.AdvancedEffectsEnabledChanged(&TypedEventHandler::new(move |_, _| {
        emit();
        Ok(())
    }))?;
    Ok(SystemWatch { _settings: settings })
}
