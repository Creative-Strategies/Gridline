//! Gridline's sparse workbook model and WebAssembly boundary.

mod error;
mod format;
mod formula;
mod model;
mod ooxml;
mod viewport;

pub use error::{GridlineError, Result};
pub use model::{Workbook, demo_workbook};

use wasm_bindgen::prelude::*;

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
        ooxml::parse_workbook(bytes)
            .map(|workbook| Self { workbook })
            .map_err(js_error)
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

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
