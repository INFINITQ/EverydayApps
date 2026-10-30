//! `.doc` to `.docx`, in memory, for Folio Docs (see docs/adr/0011).
//!
//! office_oxide reads the Word 97-2003 binary format into its document model, then writes that
//! model as a new `.docx`. Nothing here touches files or the network: bytes in, bytes out.

use std::io::Cursor;

use office_oxide::create::create_from_ir_to_writer;
use office_oxide::{Document, DocumentFormat};
use wasm_bindgen::prelude::*;

/// Converts the bytes of a `.doc` to the bytes of an equivalent `.docx`.
#[wasm_bindgen(js_name = docToDocx)]
pub fn doc_to_docx(data: &[u8]) -> Result<Vec<u8>, JsValue> {
    let document = Document::from_reader(Cursor::new(data.to_vec()), DocumentFormat::Doc)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let ir = document.to_ir();
    let mut out = Cursor::new(Vec::new());
    create_from_ir_to_writer(&ir, DocumentFormat::Docx, &mut out).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(out.into_inner())
}

/// The office_oxide version this build carries.
#[wasm_bindgen(js_name = converterVersion)]
pub fn converter_version() -> String {
    office_oxide::VERSION.to_string()
}
