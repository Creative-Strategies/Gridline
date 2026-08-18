//! Gridline's sparse workbook model and WebAssembly boundary.

mod error;
mod format;
mod formula;
mod model;
mod ooxml;
mod viewport;

pub use error::{GridlineError, Result};
pub use model::{Workbook, demo_workbook};

use office_crypto::DecryptError;
use serde::Serialize;
use wasm_bindgen::prelude::*;

const OLE_COMPOUND_MAGIC: [u8; 8] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    code: &'static str,
    message: String,
    recoverable: bool,
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct WorkbookHandle {
    workbook: Workbook,
}

#[wasm_bindgen]
impl WorkbookHandle {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> std::result::Result<WorkbookHandle, JsValue> {
        open_handle(bytes, None).map_err(gridline_js_error)
    }

    #[wasm_bindgen(js_name = open)]
    pub fn open(
        bytes: &[u8],
        password: Option<String>,
    ) -> std::result::Result<WorkbookHandle, JsValue> {
        open_handle(bytes, password.as_deref()).map_err(gridline_js_error)
    }

    #[wasm_bindgen(js_name = isOfficeEncrypted)]
    pub fn is_office_encrypted(bytes: &[u8]) -> bool {
        is_office_encrypted(bytes)
    }

    #[wasm_bindgen(js_name = demo)]
    pub fn demo() -> WorkbookHandle {
        Self {
            workbook: demo_workbook(),
        }
    }

    pub fn metadata(&self) -> std::result::Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.workbook.metadata()).map_err(js_error)
    }

    pub fn viewport(
        &self,
        sheet: usize,
        row_start: u32,
        row_end: u32,
        column_start: u32,
        column_end: u32,
    ) -> std::result::Result<JsValue, JsValue> {
        let display_list = viewport::build_viewport(
            &self.workbook,
            sheet,
            row_start,
            row_end,
            column_start,
            column_end,
        )
        .map_err(js_error)?;
        serde_wasm_bindgen::to_value(&display_list).map_err(js_error)
    }

    #[wasm_bindgen(js_name = viewportAt)]
    pub fn viewport_at(
        &self,
        sheet: usize,
        scroll_x: f32,
        scroll_y: f32,
        width: f32,
        height: f32,
        overscan: u32,
    ) -> std::result::Result<JsValue, JsValue> {
        let display_list = viewport::build_viewport_for_pixels(
            &self.workbook,
            sheet,
            scroll_x,
            scroll_y,
            width,
            height,
            overscan,
        )
        .map_err(js_error)?;
        serde_wasm_bindgen::to_value(&display_list).map_err(js_error)
    }

    pub fn cell(&self, sheet: usize, address: &str) -> std::result::Result<JsValue, JsValue> {
        let cell = self
            .workbook
            .cell_by_address(sheet, address)
            .map_err(js_error)?;
        serde_wasm_bindgen::to_value(&cell).map_err(js_error)
    }

    pub fn search(
        &self,
        sheet: usize,
        query: &str,
        limit: usize,
    ) -> std::result::Result<JsValue, JsValue> {
        let matches = self
            .workbook
            .search(sheet, query, limit)
            .map_err(js_error)?;
        serde_wasm_bindgen::to_value(&matches).map_err(js_error)
    }

    #[wasm_bindgen(js_name = exportCsv)]
    pub fn export_csv(&self, sheet: usize) -> std::result::Result<String, JsValue> {
        self.workbook.export_csv(sheet).map_err(js_error)
    }
}

fn open_handle(bytes: &[u8], password: Option<&str>) -> Result<WorkbookHandle> {
    let decrypted;
    let workbook_bytes = if is_office_encrypted(bytes) {
        let password = password.ok_or(GridlineError::PasswordRequired)?;
        decrypted = office_crypto::decrypt_from_bytes(bytes.to_vec(), password)
            .map_err(map_decryption_error)?;
        decrypted.as_slice()
    } else {
        bytes
    };

    ooxml::parse_workbook(workbook_bytes).map(|mut workbook| {
        formula::evaluate_missing_formulas_in_workbook(&mut workbook);
        WorkbookHandle { workbook }
    })
}

fn is_office_encrypted(bytes: &[u8]) -> bool {
    bytes.starts_with(&OLE_COMPOUND_MAGIC)
}

fn map_decryption_error(error: DecryptError) -> GridlineError {
    match error {
        DecryptError::Unimplemented(reason) => GridlineError::UnsupportedEncryption(reason),
        _ => GridlineError::DecryptionFailed,
    }
}

fn gridline_js_error(error: GridlineError) -> JsValue {
    let payload = ErrorPayload {
        code: error.code(),
        message: error.to_string(),
        recoverable: matches!(
            error,
            GridlineError::PasswordRequired | GridlineError::DecryptionFailed
        ),
    };
    serde_wasm_bindgen::to_value(&payload).unwrap_or_else(|_| JsValue::from_str(&payload.message))
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_office_compound_encryption_container() {
        assert!(is_office_encrypted(&OLE_COMPOUND_MAGIC));
        assert!(!is_office_encrypted(b"PK\x03\x04"));
    }

    #[test]
    fn encrypted_workbook_requires_password_before_parsing() {
        let error = open_handle(&OLE_COMPOUND_MAGIC, None)
            .err()
            .expect("encrypted input should require a password");
        assert_eq!(error.code(), "PASSWORD_REQUIRED");
    }
}
