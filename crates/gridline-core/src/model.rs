// Implemented in the engine milestone.

use crate::{GridlineError, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct WorkbookMetadata {
    pub title: String,
    pub sheets: Vec<String>,
    pub cell_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Workbook;

impl Workbook {
    pub fn metadata(&self) -> WorkbookMetadata {
        WorkbookMetadata {
            title: "Workbook.xlsx".into(),
            sheets: vec!["Sheet1".into()],
            cell_count: 0,
        }
    }

    pub fn cell_by_address(&self, _sheet: usize, address: &str) -> Result<Option<String>> {
        if address.is_empty() {
            return Err(GridlineError::InvalidAddress(address.into()));
        }
        Ok(None)
    }

    pub fn search(&self, _sheet: usize, _query: &str, _limit: usize) -> Result<Vec<String>> {
        Ok(vec![])
    }

    pub fn export_csv(&self, _sheet: usize) -> Result<String> {
        Ok(String::new())
    }
}

pub fn demo_workbook() -> Workbook {
    Workbook
}
