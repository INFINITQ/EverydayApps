//! Small secrets (saved signatures) encrypted with Windows DPAPI: only your Windows account
//! on this PC can decrypt them, and app-specific entropy ties them to this app.

use std::path::PathBuf;

use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use windows::core::w;

use crate::recovery::check_id;
use crate::{Error, Result, files};

pub struct Secure {
    dir: PathBuf,
    entropy: Vec<u8>,
}

impl Secure {
    pub fn new(dir: PathBuf, app_identifier: &str) -> Secure {
        Secure { dir, entropy: format!("folio-secure-v1:{app_identifier}").into_bytes() }
    }

    pub fn put(&self, key: &str, plain: &[u8]) -> Result<()> {
        check_id(key)?;
        std::fs::create_dir_all(&self.dir)?;
        let sealed = protect(plain, &self.entropy)?;
        files::write_atomically(&self.dir.join(format!("{key}.bin")), &sealed)
    }

    pub fn get(&self, key: &str) -> Result<Vec<u8>> {
        check_id(key)?;
        let sealed = std::fs::read(self.dir.join(format!("{key}.bin")))?;
        unprotect(&sealed, &self.entropy)
            .map_err(|_| Error::Invalid("this saved item is damaged or belongs to another account".into()))
    }

    pub fn delete(&self, key: &str) -> Result<()> {
        check_id(key)?;
        match std::fs::remove_file(self.dir.join(format!("{key}.bin"))) {
            Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
            _ => Ok(()),
        }
    }

    pub fn keys(&self) -> Result<Vec<String>> {
        let dir = match std::fs::read_dir(&self.dir) {
            Ok(dir) => dir,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.into()),
        };
        let mut keys: Vec<String> = dir
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().to_string_lossy().strip_suffix(".bin").map(str::to_owned))
            .collect();
        keys.sort();
        Ok(keys)
    }
}

fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 }
}

/// Copies DPAPI's output and frees it.
///
/// # Safety
/// `out` must have been filled by a successful DPAPI call.
unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    // SAFETY: DPAPI allocated `cbData` bytes at `pbData` with LocalAlloc.
    unsafe {
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData.cast())));
        bytes
    }
}

fn protect(plain: &[u8], entropy: &[u8]) -> Result<Vec<u8>> {
    let (input, extra) = (blob(plain), blob(entropy));
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: input blobs point at live slices; DPAPI never writes through them.
    unsafe {
        CryptProtectData(&input, w!("Folio"), Some(&extra), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)?;
        Ok(take(out))
    }
}

fn unprotect(sealed: &[u8], entropy: &[u8]) -> Result<Vec<u8>> {
    let (input, extra) = (blob(sealed), blob(entropy));
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as above.
    unsafe {
        CryptUnprotectData(&input, None, Some(&extra), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)?;
        Ok(take(out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_detects_tampering() {
        let dir = std::env::temp_dir().join(format!("folio-test-secure-{}", crate::random::hex(4).unwrap()));
        let secure = Secure::new(dir.clone(), "dev.folio.test");
        secure.put("signature-1", b"<svg>my signature</svg>").unwrap();
        assert_eq!(secure.get("signature-1").unwrap(), b"<svg>my signature</svg>");
        assert_eq!(secure.keys().unwrap(), ["signature-1"]);

        let on_disk = std::fs::read(dir.join("signature-1.bin")).unwrap();
        assert!(!on_disk.windows(9).any(|w| w == b"signature"), "stored encrypted, not in plain text");

        let mut damaged = on_disk.clone();
        let last = damaged.len() - 1;
        damaged[last] ^= 0xFF;
        std::fs::write(dir.join("signature-1.bin"), damaged).unwrap();
        assert!(secure.get("signature-1").is_err(), "tampering is detected");

        let other_app = Secure::new(dir.clone(), "dev.folio.other");
        std::fs::write(dir.join("signature-1.bin"), on_disk).unwrap();
        assert!(other_app.get("signature-1").is_err(), "another app can't read it");

        secure.delete("signature-1").unwrap();
        assert!(secure.keys().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
