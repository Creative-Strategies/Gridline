use crate::format::format_cell;
use crate::{GridlineError, Result};
use serde::Serialize;
use std::collections::BTreeMap;

pub const DEFAULT_COLUMN_WIDTH: f32 = 96.0;
pub const DEFAULT_ROW_HEIGHT: f32 = 24.0;

// CSV export materializes the full used rectangle, including blank cells. Keep
// both the work area and the resulting download bounded for browser callers.
const MAX_CSV_CELLS: u64 = 4_000_000;
const MAX_CSV_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellCoord {
    pub row: u32,
    pub column: u32,
}

impl CellCoord {
    pub const fn new(row: u32, column: u32) -> Self {
        Self { row, column }
    }

    pub fn address(self) -> String {
        format!("{}{}", column_label(self.column), self.row + 1)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum CellValue {
    Blank,
    String(String),
    Number(f64),
    Boolean(bool),
    Error(String),
}

impl CellValue {
    pub fn as_number(&self) -> Option<f64> {
        match self {
            Self::Number(value) => Some(*value),
            Self::Boolean(value) => Some(if *value { 1.0 } else { 0.0 }),
            Self::String(value) => value.parse().ok(),
            Self::Blank | Self::Error(_) => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub coord: CellCoord,
    pub value: CellValue,
    pub formula: Option<String>,
    pub style_id: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontStyle {
    pub family: String,
    pub size: f32,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderEdge {
    pub style: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderStyle {
    pub top: BorderEdge,
    pub right: BorderEdge,
    pub bottom: BorderEdge,
    pub left: BorderEdge,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentStyle {
    pub horizontal: Option<String>,
    pub vertical: Option<String>,
    pub wrap_text: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellStyle {
    pub font: FontStyle,
    pub fill: Option<String>,
    pub border: BorderStyle,
    pub alignment: AlignmentStyle,
    pub number_format: String,
}

impl Default for CellStyle {
    fn default() -> Self {
        Self {
            font: FontStyle {
                family: "Arial".into(),
                size: 11.0,
                bold: false,
                italic: false,
                underline: false,
                color: Some("#171b21".into()),
            },
            fill: None,
            border: BorderStyle::default(),
            alignment: AlignmentStyle::default(),
            number_format: "General".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSpan {
    pub start: u32,
    pub end: u32,
    pub width: f32,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRange {
    pub start: CellCoord,
    pub end: CellCoord,
}

impl MergeRange {
    pub fn contains(&self, coord: CellCoord) -> bool {
        coord.row >= self.start.row
            && coord.row <= self.end.row
            && coord.column >= self.start.column
            && coord.column <= self.end.column
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreezePane {
    pub rows: u32,
    pub columns: u32,
    pub top_left_cell: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartPoint {
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSpec {
    pub title: String,
    pub subtitle: String,
    pub anchor: CellCoord,
    pub width: f32,
    pub height: f32,
    pub points: Vec<ChartPoint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worksheet {
    pub name: String,
    pub state: String,
    pub show_grid_lines: bool,
    pub cells: BTreeMap<CellCoord, Cell>,
    pub row_heights: BTreeMap<u32, f32>,
    pub column_spans: Vec<ColumnSpan>,
    pub merged_cells: Vec<MergeRange>,
    pub freeze: FreezePane,
    pub charts: Vec<ChartSpec>,
    pub max_row: u32,
    pub max_column: u32,
}

impl Worksheet {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            state: "visible".into(),
            show_grid_lines: true,
            cells: BTreeMap::new(),
            row_heights: BTreeMap::new(),
            column_spans: Vec::new(),
            merged_cells: Vec::new(),
            freeze: FreezePane::default(),
            charts: Vec::new(),
            max_row: 0,
            max_column: 0,
        }
    }

    pub fn insert(&mut self, cell: Cell) {
        self.max_row = self.max_row.max(cell.coord.row);
        self.max_column = self.max_column.max(cell.coord.column);
        self.cells.insert(cell.coord, cell);
    }

    pub fn cell(&self, coord: CellCoord) -> Option<&Cell> {
        self.cells.get(&coord)
    }

    pub fn column_width(&self, column: u32) -> f32 {
        self.column_spans
            .iter()
            .rev()
            .find(|span| column >= span.start && column <= span.end)
            .map(|span| if span.hidden { 0.0 } else { span.width })
            .unwrap_or(DEFAULT_COLUMN_WIDTH)
    }

    pub fn row_height(&self, row: u32) -> f32 {
        self.row_heights
            .get(&row)
            .copied()
            .unwrap_or(DEFAULT_ROW_HEIGHT)
    }

    pub fn column_offset(&self, column: u32) -> f32 {
        (0..column).map(|index| self.column_width(index)).sum()
    }

    pub fn row_offset(&self, row: u32) -> f32 {
        let base = row as f32 * DEFAULT_ROW_HEIGHT;
        self.row_heights
            .range(..row)
            .map(|(_, height)| *height - DEFAULT_ROW_HEIGHT)
            .sum::<f32>()
            + base
    }

    pub fn total_width(&self) -> f32 {
        (0..=self.max_column.max(25))
            .map(|column| self.column_width(column))
            .sum()
    }

    pub fn total_height(&self) -> f32 {
        self.row_offset(self.max_row.max(99) + 1)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetMetadata {
    pub name: String,
    pub state: String,
    pub show_grid_lines: bool,
    pub rows: u32,
    pub columns: u32,
    pub cell_count: usize,
    pub freeze: FreezePane,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookMetadata {
    pub title: String,
    pub sheets: Vec<SheetMetadata>,
    pub cell_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellSnapshot {
    pub address: String,
    pub row: u32,
    pub column: u32,
    pub value: CellValue,
    pub display: String,
    pub formula: Option<String>,
    pub style: CellStyle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub address: String,
    pub row: u32,
    pub column: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workbook {
    pub title: String,
    pub sheets: Vec<Worksheet>,
    pub styles: Vec<CellStyle>,
    pub date_1904: bool,
}

impl Workbook {
    pub fn metadata(&self) -> WorkbookMetadata {
        WorkbookMetadata {
            title: self.title.clone(),
            sheets: self
                .sheets
                .iter()
                .map(|sheet| SheetMetadata {
                    name: sheet.name.clone(),
                    state: sheet.state.clone(),
                    show_grid_lines: sheet.show_grid_lines,
                    rows: if sheet.cells.is_empty() {
                        0
                    } else {
                        sheet.max_row + 1
                    },
                    columns: if sheet.cells.is_empty() {
                        0
                    } else {
                        sheet.max_column + 1
                    },
                    cell_count: sheet.cells.len(),
                    freeze: sheet.freeze.clone(),
                })
                .collect(),
            cell_count: self.sheets.iter().map(|sheet| sheet.cells.len()).sum(),
        }
    }

    pub fn style(&self, style_id: usize) -> &CellStyle {
        self.styles.get(style_id).unwrap_or_else(|| &self.styles[0])
    }

    pub fn cell_by_address(&self, sheet: usize, address: &str) -> Result<Option<CellSnapshot>> {
        let coord = parse_address(address)?;
        let worksheet = self
            .sheets
            .get(sheet)
            .ok_or(GridlineError::SheetOutOfRange(sheet))?;
        Ok(worksheet.cell(coord).map(|cell| {
            let style = self.style(cell.style_id).clone();
            CellSnapshot {
                address: coord.address(),
                row: coord.row,
                column: coord.column,
                value: cell.value.clone(),
                display: format_cell(&cell.value, &style.number_format, self.date_1904),
                formula: cell.formula.clone(),
                style,
            }
        }))
    }

    pub fn search(&self, sheet: usize, query: &str, limit: usize) -> Result<Vec<SearchMatch>> {
        let worksheet = self
            .sheets
            .get(sheet)
            .ok_or(GridlineError::SheetOutOfRange(sheet))?;
        let needle = query.trim().to_lowercase();
        if needle.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let mut matches = Vec::new();
        for cell in worksheet.cells.values() {
            let style = self.style(cell.style_id);
            let text = format_cell(&cell.value, &style.number_format, self.date_1904);
            if text.to_lowercase().contains(&needle)
                || cell
                    .formula
                    .as_deref()
                    .is_some_and(|formula| formula.to_lowercase().contains(&needle))
            {
                matches.push(SearchMatch {
                    address: cell.coord.address(),
                    row: cell.coord.row,
                    column: cell.coord.column,
                    text,
                });
                if matches.len() == limit.min(1_000) {
                    break;
                }
            }
        }
        Ok(matches)
    }

    pub fn export_csv(&self, sheet: usize) -> Result<String> {
        let worksheet = self
            .sheets
            .get(sheet)
            .ok_or(GridlineError::SheetOutOfRange(sheet))?;
        let row_count = u64::from(worksheet.max_row) + 1;
        let column_count = u64::from(worksheet.max_column) + 1;
        let cell_area = row_count
            .checked_mul(column_count)
            .ok_or_else(|| GridlineError::ResourceLimit("CSV export area overflowed".into()))?;
        if cell_area > MAX_CSV_CELLS {
            return Err(GridlineError::ResourceLimit(format!(
                "CSV export covers {cell_area} cells; limit is {MAX_CSV_CELLS}"
            )));
        }
        let minimum_bytes = cell_area
            .checked_add(row_count)
            .ok_or_else(|| GridlineError::ResourceLimit("CSV export size overflowed".into()))?;
        if minimum_bytes > MAX_CSV_BYTES as u64 {
            return Err(GridlineError::ResourceLimit(format!(
                "CSV export exceeds {MAX_CSV_BYTES} bytes"
            )));
        }
        let mut csv = String::with_capacity(minimum_bytes as usize);
        for row in 0..=worksheet.max_row {
            for column in 0..=worksheet.max_column {
                let separator = usize::from(column > 0);
                if let Some(cell) = worksheet.cell(CellCoord::new(row, column)) {
                    let text = format_cell(
                        &cell.value,
                        &self.style(cell.style_id).number_format,
                        self.date_1904,
                    );
                    let protect_formula =
                        matches!(&cell.value, CellValue::String(_) | CellValue::Error(_));
                    let escaped = escape_csv_field(&text, protect_formula);
                    let field_bytes = separator.checked_add(escaped.len()).ok_or_else(|| {
                        GridlineError::ResourceLimit("CSV export size overflowed".into())
                    })?;
                    ensure_csv_capacity(csv.len(), field_bytes)?;
                    if separator != 0 {
                        csv.push(',');
                    }
                    csv.push_str(&escaped);
                } else {
                    ensure_csv_capacity(csv.len(), separator)?;
                    if separator != 0 {
                        csv.push(',');
                    }
                }
            }
            ensure_csv_capacity(csv.len(), 1)?;
            csv.push('\n');
        }
        Ok(csv)
    }
}

pub fn parse_address(address: &str) -> Result<CellCoord> {
    let normalized = address.trim().replace('$', "").to_ascii_uppercase();
    let split = normalized
        .find(|character: char| character.is_ascii_digit())
        .ok_or_else(|| GridlineError::InvalidAddress(address.into()))?;
    let (letters, digits) = normalized.split_at(split);
    if letters.is_empty()
        || digits.is_empty()
        || !digits.chars().all(|value| value.is_ascii_digit())
    {
        return Err(GridlineError::InvalidAddress(address.into()));
    }
    let mut column = 0u32;
    for character in letters.chars() {
        if !character.is_ascii_uppercase() {
            return Err(GridlineError::InvalidAddress(address.into()));
        }
        column = column
            .checked_mul(26)
            .and_then(|value| value.checked_add(character as u32 - 'A' as u32 + 1))
            .ok_or_else(|| GridlineError::InvalidAddress(address.into()))?;
    }
    let row = digits
        .parse::<u32>()
        .map_err(|_| GridlineError::InvalidAddress(address.into()))?;
    if row == 0 || column == 0 || row > 1_048_576 || column > 16_384 {
        return Err(GridlineError::InvalidAddress(address.into()));
    }
    Ok(CellCoord::new(row - 1, column - 1))
}

pub fn parse_range(reference: &str) -> Result<MergeRange> {
    let mut parts = reference.split(':');
    let start = parse_address(parts.next().unwrap_or_default())?;
    let end = parts
        .next()
        .map(parse_address)
        .transpose()?
        .unwrap_or(start);
    if parts.next().is_some() || end.row < start.row || end.column < start.column {
        return Err(GridlineError::InvalidAddress(reference.into()));
    }
    Ok(MergeRange { start, end })
}

pub fn column_label(mut column: u32) -> String {
    let mut label = String::new();
    loop {
        let remainder = (column % 26) as u8;
        label.insert(0, (b'A' + remainder) as char);
        if column < 26 {
            break;
        }
        column = column / 26 - 1;
    }
    label
}

fn escape_csv_field(value: &str, protect_formula: bool) -> String {
    let dangerous_prefix = protect_formula
        && value
            .chars()
            .find(|character| !character.is_whitespace())
            .is_some_and(|character| matches!(character, '=' | '+' | '-' | '@'));
    let quoted = value.contains([',', '"', '\n', '\r']);
    let escaped_quotes = value.bytes().filter(|byte| *byte == b'"').count();
    let prefix_len = usize::from(dangerous_prefix);
    let mut escaped = String::with_capacity(
        value
            .len()
            .saturating_add(escaped_quotes)
            .saturating_add(prefix_len)
            .saturating_add(usize::from(quoted) * 2),
    );
    if quoted {
        escaped.push('"');
    }
    if dangerous_prefix {
        // A leading apostrophe makes Excel/Sheets treat the field as text while
        // retaining the original string (including leading whitespace).
        escaped.push('\'');
    }
    for character in value.chars() {
        if character == '"' {
            escaped.push('"');
        }
        escaped.push(character);
    }
    if quoted {
        escaped.push('"');
    }
    escaped
}

fn ensure_csv_capacity(current: usize, additional: usize) -> Result<()> {
    match current.checked_add(additional) {
        Some(total) if total <= MAX_CSV_BYTES => Ok(()),
        _ => Err(GridlineError::ResourceLimit(format!(
            "CSV export exceeds {MAX_CSV_BYTES} bytes"
        ))),
    }
}

fn base_cell(row: u32, column: u32, value: CellValue, style_id: usize) -> Cell {
    Cell {
        coord: CellCoord::new(row, column),
        value,
        formula: None,
        style_id,
    }
}

pub fn demo_workbook() -> Workbook {
    let styles = demo_styles();
    let mut summary = Worksheet::new("Executive Summary");
    summary.freeze = FreezePane {
        rows: 3,
        columns: 1,
        top_left_cell: Some("B4".into()),
    };
    summary.column_spans = vec![
        ColumnSpan {
            start: 0,
            end: 0,
            width: 190.0,
            hidden: false,
        },
        ColumnSpan {
            start: 1,
            end: 5,
            width: 124.0,
            hidden: false,
        },
        ColumnSpan {
            start: 6,
            end: 6,
            width: 28.0,
            hidden: false,
        },
        ColumnSpan {
            start: 7,
            end: 11,
            width: 82.0,
            hidden: false,
        },
    ];
    summary.row_heights.insert(0, 56.0);
    summary.row_heights.insert(2, 36.0);
    summary.insert(base_cell(
        0,
        0,
        CellValue::String("FY26 OPERATING PLAN".into()),
        1,
    ));
    summary.merged_cells.push(MergeRange {
        start: CellCoord::new(0, 0),
        end: CellCoord::new(0, 5),
    });

    for (column, heading) in ["Metric", "Q1", "Q2", "Q3", "Q4", "FY26"]
        .iter()
        .enumerate()
    {
        summary.insert(base_cell(
            2,
            column as u32,
            CellValue::String((*heading).into()),
            2,
        ));
    }
    let metrics = [
        (
            "Revenue",
            [
                1_120_000.0,
                1_230_000.0,
                1_340_000.0,
                1_480_000.0,
                5_170_000.0,
            ],
        ),
        (
            "Gross profit",
            [392_000.0, 431_000.0, 469_000.0, 518_000.0, 1_810_000.0],
        ),
        (
            "Operating expenses",
            [258_000.0, 266_000.0, 277_000.0, 293_000.0, 1_094_000.0],
        ),
        (
            "Operating income",
            [134_000.0, 165_000.0, 192_000.0, 225_000.0, 716_000.0],
        ),
        ("Headcount", [112.0, 120.0, 125.0, 130.0, 130.0]),
    ];
    for (offset, (label, values)) in metrics.iter().enumerate() {
        let row = 3 + offset as u32;
        summary.insert(base_cell(row, 0, CellValue::String((*label).into()), 0));
        for (index, value) in values.iter().enumerate() {
            let style = if offset == 4 {
                5
            } else if index == 4 {
                4
            } else {
                3
            };
            let mut cell = base_cell(row, index as u32 + 1, CellValue::Number(*value), style);
            if row == 7 && index == 1 {
                cell.formula = Some("=SUM(C4:C7)".into());
            }
            summary.insert(cell);
        }
    }
    summary.insert(base_cell(
        9,
        0,
        CellValue::String("Key Assumptions".into()),
        6,
    ));
    summary.insert(base_cell(9, 3, CellValue::String("Highlights".into()), 6));
    let assumptions = [
        ("Average selling price increase", 0.03),
        ("Customer growth", 0.12),
        ("Gross margin", 0.35),
        ("Operating expense as % of revenue", 0.212),
    ];
    let highlights = [
        "Revenue grows 16% year-over-year",
        "Operating income margin of 13.8%",
        "Headcount increases modestly to support growth",
        "Investments focused on product and go-to-market",
    ];
    for row in 0..4 {
        summary.insert(base_cell(
            10 + row,
            0,
            CellValue::String(assumptions[row as usize].0.into()),
            0,
        ));
        summary.insert(base_cell(
            10 + row,
            1,
            CellValue::Number(assumptions[row as usize].1),
            7,
        ));
        summary.insert(base_cell(
            10 + row,
            3,
            CellValue::String(format!("•  {}", highlights[row as usize])),
            0,
        ));
        summary.merged_cells.push(MergeRange {
            start: CellCoord::new(10 + row, 3),
            end: CellCoord::new(10 + row, 5),
        });
    }
    summary.charts.push(ChartSpec {
        title: "Revenue by Quarter".into(),
        subtitle: "USD millions".into(),
        anchor: CellCoord::new(2, 7),
        width: 340.0,
        height: 288.0,
        points: vec![
            ChartPoint {
                label: "Q1".into(),
                value: 1.12,
            },
            ChartPoint {
                label: "Q2".into(),
                value: 1.23,
            },
            ChartPoint {
                label: "Q3".into(),
                value: 1.34,
            },
            ChartPoint {
                label: "Q4".into(),
                value: 1.48,
            },
        ],
    });

    let summary_count = summary.cells.len();
    let revenue = planning_sheet("Revenue Plan", 1_000, "Region");
    let headcount = planning_sheet("Headcount", 800, "Department");
    let assumptions_count = 2_418usize.saturating_sub(summary_count + 1_800);
    let assumptions_sheet = planning_sheet("Assumptions", assumptions_count, "Driver");

    Workbook {
        title: "FY26 Operating Plan.xlsx".into(),
        sheets: vec![summary, revenue, headcount, assumptions_sheet],
        styles,
        date_1904: false,
    }
}

fn planning_sheet(name: &str, target_cells: usize, first_heading: &str) -> Worksheet {
    let mut sheet = Worksheet::new(name);
    sheet.freeze = FreezePane {
        rows: 1,
        columns: 1,
        top_left_cell: Some("B2".into()),
    };
    sheet.column_spans.push(ColumnSpan {
        start: 0,
        end: 0,
        width: 180.0,
        hidden: false,
    });
    sheet.column_spans.push(ColumnSpan {
        start: 1,
        end: 7,
        width: 112.0,
        hidden: false,
    });
    let headings = [
        first_heading,
        "Q1",
        "Q2",
        "Q3",
        "Q4",
        "FY26",
        "Variance",
        "Owner",
    ];
    let mut inserted = 0usize;
    for (column, heading) in headings.iter().enumerate() {
        if inserted == target_cells {
            return sheet;
        }
        sheet.insert(base_cell(
            0,
            column as u32,
            CellValue::String((*heading).into()),
            2,
        ));
        inserted += 1;
    }
    let mut row = 1u32;
    while inserted < target_cells {
        for column in 0..8u32 {
            if inserted == target_cells {
                break;
            }
            let value = if column == 0 {
                CellValue::String(format!("{} {}", first_heading, row))
            } else if column == 7 {
                CellValue::String(
                    ["Operations", "Finance", "Sales", "Product"]
                        [(row as usize + column as usize) % 4]
                        .into(),
                )
            } else {
                CellValue::Number((row as f64 * 12_500.0) + (column as f64 * 4_250.0))
            };
            sheet.insert(base_cell(
                row,
                column,
                value,
                if column == 0 || column == 7 { 0 } else { 3 },
            ));
            inserted += 1;
        }
        row += 1;
    }
    sheet
}

fn demo_styles() -> Vec<CellStyle> {
    let base = CellStyle::default();
    vec![
        base.clone(),
        CellStyle {
            font: FontStyle {
                family: "Arial".into(),
                size: 20.0,
                bold: true,
                color: Some("#08783e".into()),
                ..FontStyle::default()
            },
            ..base.clone()
        },
        CellStyle {
            font: FontStyle {
                family: "Arial".into(),
                size: 11.0,
                bold: true,
                color: Some("#ffffff".into()),
                ..FontStyle::default()
            },
            fill: Some("#08783e".into()),
            alignment: AlignmentStyle {
                horizontal: Some("center".into()),
                vertical: Some("center".into()),
                wrap_text: false,
            },
            ..base.clone()
        },
        CellStyle {
            number_format: "$#,##0".into(),
            alignment: AlignmentStyle {
                horizontal: Some("right".into()),
                ..AlignmentStyle::default()
            },
            ..base.clone()
        },
        CellStyle {
            font: FontStyle {
                bold: true,
                ..base.font.clone()
            },
            number_format: "$#,##0".into(),
            alignment: AlignmentStyle {
                horizontal: Some("right".into()),
                ..AlignmentStyle::default()
            },
            ..base.clone()
        },
        CellStyle {
            alignment: AlignmentStyle {
                horizontal: Some("right".into()),
                ..AlignmentStyle::default()
            },
            number_format: "0".into(),
            ..base.clone()
        },
        CellStyle {
            font: FontStyle {
                bold: true,
                color: Some("#2f5db5".into()),
                ..base.font.clone()
            },
            ..base.clone()
        },
        CellStyle {
            number_format: "0.0%".into(),
            alignment: AlignmentStyle {
                horizontal: Some("right".into()),
                ..AlignmentStyle::default()
            },
            ..base
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats_addresses() {
        assert_eq!(parse_address("$AA$17").unwrap(), CellCoord::new(16, 26));
        assert_eq!(CellCoord::new(16, 26).address(), "AA17");
        assert!(parse_address("A0").is_err());
        assert!(parse_address("XFE1").is_err());
    }

    #[test]
    fn demo_has_locked_cell_count() {
        let workbook = demo_workbook();
        assert_eq!(workbook.metadata().cell_count, 2_418);
        assert_eq!(workbook.metadata().sheets.len(), 4);
    }

    #[test]
    fn csv_escapes_special_values() {
        assert_eq!(escape_csv_field("north, east", false), "\"north, east\"");
        assert_eq!(
            escape_csv_field("quoted \"value\"", false),
            "\"quoted \"\"value\"\"\""
        );
    }

    fn export_fixture(cells: impl IntoIterator<Item = Cell>) -> Workbook {
        let mut worksheet = Worksheet::new("Export");
        for cell in cells {
            worksheet.insert(cell);
        }
        Workbook {
            title: "Export fixture".into(),
            sheets: vec![worksheet],
            styles: vec![CellStyle::default()],
            date_1904: false,
        }
    }

    #[test]
    fn csv_neutralizes_formula_like_strings_but_preserves_numeric_negatives() {
        let workbook = export_fixture([
            Cell {
                coord: CellCoord::new(0, 0),
                value: CellValue::String("=SUM(A1:A2)".into()),
                formula: None,
                style_id: 0,
            },
            Cell {
                coord: CellCoord::new(1, 0),
                value: CellValue::Number(-12.5),
                formula: None,
                style_id: 0,
            },
            Cell {
                coord: CellCoord::new(2, 0),
                value: CellValue::String("  +not-a-formula".into()),
                formula: None,
                style_id: 0,
            },
        ]);
        assert_eq!(
            workbook.export_csv(0).unwrap(),
            "'=SUM(A1:A2)\n-12.5\n'  +not-a-formula\n"
        );
    }

    #[test]
    fn csv_neutralization_preserves_rfc_quoting_and_multiline_text() {
        let workbook = export_fixture([Cell {
            coord: CellCoord::new(0, 0),
            value: CellValue::String("\t@mention, \"quoted\"\nnext".into()),
            formula: None,
            style_id: 0,
        }]);
        assert_eq!(
            workbook.export_csv(0).unwrap(),
            "\"'\t@mention, \"\"quoted\"\"\nnext\"\n"
        );
    }

    #[test]
    fn csv_rejects_a_far_cell_before_iterating_the_rectangle() {
        let workbook = export_fixture([Cell {
            coord: CellCoord::new(1_048_575, 16_383),
            value: CellValue::Number(1.0),
            formula: None,
            style_id: 0,
        }]);
        assert!(matches!(
            workbook.export_csv(0),
            Err(GridlineError::ResourceLimit(message)) if message.contains("CSV export")
        ));
    }

    #[test]
    fn csv_rejects_output_that_exceeds_the_download_limit() {
        let workbook = export_fixture([Cell {
            coord: CellCoord::new(0, 0),
            value: CellValue::String("x".repeat(MAX_CSV_BYTES)),
            formula: None,
            style_id: 0,
        }]);
        assert!(matches!(
            workbook.export_csv(0),
            Err(GridlineError::ResourceLimit(message)) if message.contains("bytes")
        ));
    }
}
