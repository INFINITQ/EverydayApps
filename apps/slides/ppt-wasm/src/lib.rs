//! Converts an old PowerPoint 97-2003 (.ppt) file to a .pptx, in memory, with office_oxide.
//!
//! The module imports nothing: it can't reach files, the network or the page, only compute
//! on the bytes it's handed. The page calls `alloc`, copies the .ppt in, calls `convert`,
//! then reads the result (or an error message) from `output_ptr`/`output_len`.

use std::io::Cursor;

use office_oxide::{Document, DocumentFormat, create::create_from_ir_to_writer};

static mut OUTPUT: Vec<u8> = Vec::new();

/// Memory for the input, owned by the caller until `convert` takes it.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Converts the `len` bytes at `ptr` (from `alloc`, freed here). Returns 0 when the output
/// is a .pptx, 1 when it's an error message (UTF-8).
///
/// # Safety
/// `ptr` must come from `alloc(len)` and hold `len` initialized bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn convert(ptr: *mut u8, len: usize) -> u32 {
    // SAFETY: the caller hands back exactly what `alloc(len)` gave it, now filled.
    let input = unsafe { Vec::from_raw_parts(ptr, len, len) };
    let (code, bytes) = match run(input) {
        Ok(pptx) => (0, pptx),
        Err(message) => (1, message.into_bytes()),
    };
    // SAFETY: single-threaded module; nothing else touches OUTPUT during this call.
    unsafe { *std::ptr::addr_of_mut!(OUTPUT) = bytes };
    code
}

fn run(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let document = Document::from_reader(Cursor::new(input), DocumentFormat::Ppt).map_err(|e| e.to_string())?;
    let ir = document.to_ir();
    let mut out = Cursor::new(Vec::new());
    create_from_ir_to_writer(&ir, DocumentFormat::Pptx, &mut out).map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *const u8 {
    // SAFETY: read-only view of OUTPUT; single-threaded.
    unsafe { (*std::ptr::addr_of!(OUTPUT)).as_ptr() }
}

#[unsafe(no_mangle)]
pub extern "C" fn output_len() -> usize {
    // SAFETY: as above.
    unsafe { (*std::ptr::addr_of!(OUTPUT)).len() }
}
