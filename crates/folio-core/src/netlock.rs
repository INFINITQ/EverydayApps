//! Folio's network lock (docs/adr/0005). WebView2's own browser process talks to Microsoft
//! outside anything an app controls, so Folio uses a private copy of the runtime, made by
//! `tools/network-lock.ps1` (run once as administrator), and Windows Firewall blocks that
//! copy, and only that copy, from the network. Without it, Folio falls back to the shared
//! WebView2 and tells the user the lock is off.

use std::path::{Path, PathBuf};

use serde::Serialize;
use windows::Win32::Foundation::VARIANT_TRUE;
use windows::Win32::NetworkManagement::WindowsFirewall::{
    INetFwPolicy2, NET_FW_ACTION_BLOCK, NET_FW_RULE_DIR_OUT, NetFwPolicy2,
};
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::core::BSTR;

/// Must match `$RuleName` in tools/network-lock.ps1.
pub const RULE_NAME: &str = "Folio: block private WebView2";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkLock {
    /// Folio's private WebView2 runtime exists and is used by this app.
    pub private_runtime: bool,
    pub runtime_version: Option<String>,
    /// Windows Firewall blocks the private runtime's outbound connections.
    pub firewall_rule: bool,
    /// Both of the above: nothing in this app can reach the network.
    pub active: bool,
}

/// `C:\Program Files\Folio\WebView2Runtime\current`, if the private runtime is installed.
pub fn runtime_dir() -> Option<PathBuf> {
    let base = std::env::var_os("ProgramFiles")?;
    let dir = PathBuf::from(base).join(r"Folio\WebView2Runtime\current");
    dir.join("msedgewebview2.exe").is_file().then_some(dir)
}

fn runtime_version(dir: &Path) -> Option<String> {
    let marker = std::fs::read(dir.join("folio-runtime.json")).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&marker).ok()?;
    value.get("version")?.as_str().map(str::to_owned)
}

/// Whether Windows Firewall has our rule, enabled, blocking outbound traffic from `exe`.
fn firewall_blocks(exe: &Path) -> bool {
    // SAFETY: COM calls on this thread; read-only queries of the firewall policy.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let Ok(policy) = CoCreateInstance::<_, INetFwPolicy2>(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER) else {
            return false;
        };
        let Ok(rule) = policy.Rules().and_then(|rules| rules.Item(&BSTR::from(RULE_NAME))) else {
            return false;
        };
        let blocks_out = rule.Direction().is_ok_and(|d| d == NET_FW_RULE_DIR_OUT)
            && rule.Action().is_ok_and(|a| a == NET_FW_ACTION_BLOCK)
            && rule.Enabled().is_ok_and(|e| e == VARIANT_TRUE);
        let program = rule.ApplicationName().map(|name| name.to_string()).unwrap_or_default();
        blocks_out && program.eq_ignore_ascii_case(&exe.to_string_lossy())
    }
}

pub fn status() -> NetworkLock {
    let dir = runtime_dir();
    let firewall_rule = dir.as_ref().is_some_and(|d| firewall_blocks(&d.join("msedgewebview2.exe")));
    NetworkLock {
        private_runtime: dir.is_some(),
        runtime_version: dir.as_deref().and_then(runtime_version),
        firewall_rule,
        active: dir.is_some() && firewall_rule,
    }
}
