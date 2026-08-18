use crate::{Result, Workbook};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DisplayList {
    pub cells: Vec<String>,
}

pub fn build_viewport(
    _workbook: &Workbook,
    _sheet: usize,
    _row_start: u32,
    _row_end: u32,
    _column_start: u32,
    _column_end: u32,
) -> Result<DisplayList> {
    Ok(DisplayList { cells: vec![] })
}
