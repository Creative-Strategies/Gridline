use crate::format::format_cell;
use crate::model::{
    CellCoord, CellStyle, CellValue, ChartPoint, MergeRange, Workbook, column_label,
};
use crate::{GridlineError, Result};
use serde::Serialize;

const MAX_VIEWPORT_CELLS: u64 = 60_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMetric {
    pub index: u32,
    pub label: String,
    pub offset: f32,
    pub size: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCell {
    pub address: String,
    pub row: u32,
    pub column: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub text: String,
    pub value: CellValue,
    pub formula: Option<String>,
    pub style_id: usize,
    pub merged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMerge {
    pub start: CellCoord,
    pub end: CellCoord,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayChart {
    pub title: String,
    pub subtitle: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub points: Vec<ChartPoint>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayList {
    pub sheet_name: String,
    pub row_start: u32,
    pub row_end: u32,
    pub column_start: u32,
    pub column_end: u32,
    pub origin_x: f32,
    pub origin_y: f32,
    pub total_width: f32,
    pub total_height: f32,
    pub rows: Vec<AxisMetric>,
    pub columns: Vec<AxisMetric>,
    pub cells: Vec<DisplayCell>,
    pub merges: Vec<DisplayMerge>,
    pub charts: Vec<DisplayChart>,
    pub styles: Vec<CellStyle>,
}

pub fn build_viewport(
    workbook: &Workbook,
    sheet: usize,
    row_start: u32,
    row_end: u32,
    column_start: u32,
    column_end: u32,
) -> Result<DisplayList> {
    let worksheet = workbook
        .sheets
        .get(sheet)
        .ok_or(GridlineError::SheetOutOfRange(sheet))?;
    if row_end <= row_start || column_end <= column_start {
        return Err(GridlineError::ResourceLimit(
            "viewport bounds must be non-empty and ordered".into(),
        ));
    }
    let requested_cells = u64::from(row_end - row_start) * u64::from(column_end - column_start);
    if requested_cells > MAX_VIEWPORT_CELLS {
        return Err(GridlineError::ResourceLimit(format!(
            "viewport requested {requested_cells} cells; limit is {MAX_VIEWPORT_CELLS}"
        )));
    }

    let origin_x = worksheet.column_offset(column_start);
    let origin_y = worksheet.row_offset(row_start);
    let mut columns = Vec::with_capacity((column_end - column_start) as usize);
    let mut x = 0.0;
    for column in column_start..column_end {
        let width = worksheet.column_width(column);
        columns.push(AxisMetric {
            index: column,
            label: column_label(column),
            offset: x,
            size: width,
        });
        x += width;
    }
    let mut rows = Vec::with_capacity((row_end - row_start) as usize);
    let mut y = 0.0;
    for row in row_start..row_end {
        let height = worksheet.row_height(row);
        rows.push(AxisMetric {
            index: row,
            label: (row + 1).to_string(),
            offset: y,
            size: height,
        });
        y += height;
    }

    let intersecting_merges = worksheet
        .merged_cells
        .iter()
        .filter(|range| {
            range.end.row >= row_start
                && range.start.row < row_end
                && range.end.column >= column_start
                && range.start.column < column_end
        })
        .collect::<Vec<_>>();
    let merges = intersecting_merges
        .iter()
        .map(|range| display_merge(worksheet, range, origin_x, origin_y))
        .collect::<Vec<_>>();

    let mut cells = Vec::new();
    for (_, cell) in worksheet
        .cells
        .range(CellCoord::new(row_start, 0)..CellCoord::new(row_end, 0))
    {
        if cell.coord.column < column_start || cell.coord.column >= column_end {
            continue;
        }
        let merge = intersecting_merges
            .iter()
            .find(|range| range.contains(cell.coord));
        if merge.is_some_and(|range| range.start != cell.coord) {
            continue;
        }
        let style = workbook.style(cell.style_id);
        let (width, height, merged) = if let Some(range) = merge {
            (
                (range.start.column..=range.end.column)
                    .map(|column| worksheet.column_width(column))
                    .sum(),
                (range.start.row..=range.end.row)
                    .map(|row| worksheet.row_height(row))
                    .sum(),
                true,
            )
        } else {
            (
                worksheet.column_width(cell.coord.column),
                worksheet.row_height(cell.coord.row),
                false,
            )
        };
        cells.push(DisplayCell {
            address: cell.coord.address(),
            row: cell.coord.row,
            column: cell.coord.column,
            x: worksheet.column_offset(cell.coord.column) - origin_x,
            y: worksheet.row_offset(cell.coord.row) - origin_y,
            width,
            height,
            text: format_cell(&cell.value, &style.number_format, workbook.date_1904),
            value: cell.value.clone(),
            formula: cell.formula.clone(),
            style_id: cell.style_id.min(workbook.styles.len().saturating_sub(1)),
            merged,
        });
    }

    let viewport_width = x;
    let viewport_height = y;
    let charts = worksheet
        .charts
        .iter()
        .filter_map(|chart| {
            let chart_x = worksheet.column_offset(chart.anchor.column) - origin_x;
            let chart_y = worksheet.row_offset(chart.anchor.row) - origin_y;
            (chart_x + chart.width >= 0.0
                && chart_y + chart.height >= 0.0
                && chart_x <= viewport_width
                && chart_y <= viewport_height)
                .then(|| DisplayChart {
                    title: chart.title.clone(),
                    subtitle: chart.subtitle.clone(),
                    x: chart_x,
                    y: chart_y,
                    width: chart.width,
                    height: chart.height,
                    points: chart.points.clone(),
                })
        })
        .collect();

    Ok(DisplayList {
        sheet_name: worksheet.name.clone(),
        row_start,
        row_end,
        column_start,
        column_end,
        origin_x,
        origin_y,
        total_width: worksheet.total_width(),
        total_height: worksheet.total_height(),
        rows,
        columns,
        cells,
        merges,
        charts,
        styles: workbook.styles.clone(),
    })
}

fn display_merge(
    worksheet: &crate::model::Worksheet,
    range: &MergeRange,
    origin_x: f32,
    origin_y: f32,
) -> DisplayMerge {
    DisplayMerge {
        start: range.start,
        end: range.end,
        x: worksheet.column_offset(range.start.column) - origin_x,
        y: worksheet.row_offset(range.start.row) - origin_y,
        width: (range.start.column..=range.end.column)
            .map(|column| worksheet.column_width(column))
            .sum(),
        height: (range.start.row..=range.end.row)
            .map(|row| worksheet.row_height(row))
            .sum(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::demo_workbook;

    #[test]
    fn builds_sparse_paint_ready_viewport() {
        let workbook = demo_workbook();
        let viewport = build_viewport(&workbook, 0, 0, 16, 0, 12).unwrap();
        assert_eq!(viewport.columns.len(), 12);
        assert_eq!(viewport.rows.len(), 16);
        assert!(
            viewport
                .cells
                .iter()
                .any(|cell| cell.text == "FY26 OPERATING PLAN")
        );
        assert_eq!(viewport.charts.len(), 1);
        assert!(viewport.total_width > 1_000.0);
    }

    #[test]
    fn rejects_oversized_viewports() {
        let workbook = demo_workbook();
        assert!(build_viewport(&workbook, 0, 0, 1_000, 0, 1_000).is_err());
    }
}
