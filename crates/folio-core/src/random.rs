//! Random identifiers from the Windows system RNG (no extra dependency).

use windows::Win32::Security::Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom};

use crate::Result;

/// `bytes` random bytes as lowercase hex.
pub fn hex(bytes: usize) -> Result<String> {
    let mut buffer = vec![0u8; bytes];
    // SAFETY: fills our own buffer using the system-preferred RNG.
    unsafe { BCryptGenRandom(None, &mut buffer, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.ok()?;
    Ok(buffer.iter().map(|b| format!("{b:02x}")).collect())
}
