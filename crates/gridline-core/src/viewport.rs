use crate::format::format_cell;
use crate::model::{
    CellCoord, CellStyle, CellValue, ChartPoint, FreezePane, MergeRange, Workbook, column_label,
};
use crate::{GridlineError, Result};
use serde::Serialize;

const MAX_VIEWPORT_CELLS: u64 = 60_000;

pub fn build_viewport_for_pixels(
    workbook: &Workbook,
    sheet: usize,
    scroll_x: f32,
    scroll_y: f32,
    width: f32,
    height: f32,
    overscan: u32,
) -> Result<DisplayList> {
    let worksheet = workbook
        .sheets
        .get(sheet)
        .ok_or(GridlineError::SheetOutOfRange(sheet))?;
    if !scroll_x.is_finite()
        || !scroll_y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
    {
        return Err(GridlineError::ResourceLimit(
            "pixel viewport must use finite positive dimensions".into(),
        ));
    }
    let column_start = axis_index_at(scroll_x.max(0.0), |index| worksheet.column_width(index))
        .saturating_sub(overscan.min(32));
    let row_start = axis_index_at(scroll_y.max(0.0), |index| worksheet.row_height(index))
        .saturating_sub(overscan.min(128));
    let column_end = axis_end_at(
        column_start,
        scroll_x.max(0.0) + width,
        |index| worksheet.column_width(index),
        16_384,
    )
    .saturating_add(overscan.min(32))
    .min(16_384);
    let row_end = axis_end_at(
        row_start,
        scroll_y.max(0.0) + height,
        |index| worksheet.row_height(index),
        1_048_576,
    )
    .saturating_add(overscan.min(128))
    .min(1_048_576);
    build_viewport(
        workbook,
        sheet,
        row_start,
        row_end.max(row_start + 1),
        column_start,
        column_end.max(column_start + 1),
    )
}

fn axis_index_at(mut offset: f32, size: impl Fn(u32) -> f32) -> u32 {
    let mut index = 0u32;
    while index < 1_048_576 {
        let current = size(index);
        if current > 0.0 && offset < current {
            break;
        }
        offset -= current;
        index += 1;
    }
    index
}

fn axis_end_at(start: u32, absolute_end: f32, size: impl Fn(u32) -> f32, limit: u32) -> u32 {
    let mut index = 0u32;
    let mut offset = 0.0;
    while index < start && index < limit {
        offset += size(index);
        index += 1;
    }
    while index < limit && offset < absolute_end {
        offset += size(index);
        index += 1;
    }
    index
}

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
    pub row: u32,
    pub column: u32,
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
    pub freeze: FreezePane,
    pub show_grid_lines: bool,
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
    let frozen_row_end = worksheet.freeze.rows.min(1_048_576);
    let frozen_column_end = worksheet.freeze.columns.min(16_384);
    let row_count = axis_union_len(frozen_row_end, row_start, row_end);
    let column_count = axis_union_len(frozen_column_end, column_start, column_end);
    let requested_cells = row_count * column_count;
    if requested_cells > MAX_VIEWPORT_CELLS {
        return Err(GridlineError::ResourceLimit(format!(
            "viewport requested {requested_cells} cells; limit is {MAX_VIEWPORT_CELLS}"
        )));
    }

    let origin_x = worksheet.column_offset(column_start);
    let origin_y = worksheet.row_offset(row_start);
    let column_ranges = axis_union_ranges(frozen_column_end, column_start, column_end);
    let row_ranges = axis_union_ranges(frozen_row_end, row_start, row_end);
    let mut column_indices = Vec::with_capacity(column_count as usize);
    let mut columns = Vec::with_capacity(column_count as usize);
    for range in &column_ranges {
        let mut absolute_x = worksheet.column_offset(range.start);
        for column in range.clone() {
            let width = worksheet.column_width(column);
            column_indices.push(column);
            columns.push(AxisMetric {
                index: column,
                label: column_label(column),
                offset: absolute_x - origin_x,
                size: width,
            });
            absolute_x += width;
        }
    }
    let mut rows = Vec::with_capacity(row_count as usize);
    for range in &row_ranges {
        let mut absolute_y = worksheet.row_offset(range.start);
        for row in range.clone() {
            let height = worksheet.row_height(row);
            rows.push(AxisMetric {
                index: row,
                label: (row + 1).to_string(),
                offset: absolute_y - origin_y,
                size: height,
            });
            absolute_y += height;
        }
    }

    let intersecting_merges = worksheet
        .merged_cells
        .iter()
        .filter(|range| {
            axis_union_intersects(
                range.start.row,
                range.end.row.saturating_add(1),
                frozen_row_end,
                row_start,
                row_end,
            ) && axis_union_intersects(
                range.start.column,
                range.end.column.saturating_add(1),
                frozen_column_end,
                column_start,
                column_end,
            )
        })
        .collect::<Vec<_>>();
    let merges = intersecting_merges
        .iter()
        .map(|range| display_merge(worksheet, range, origin_x, origin_y))
        .collect::<Vec<_>>();

    let mut cells = Vec::new();
    for row_range in row_ranges {
        for (_, cell) in worksheet
            .cells
            .range(CellCoord::new(row_range.start, 0)..CellCoord::new(row_range.end, 0))
        {
            if column_indices.binary_search(&cell.coord.column).is_err() {
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
    }

    let viewport_width = worksheet.column_offset(column_end) - origin_x;
    let viewport_height = worksheet.row_offset(row_end) - origin_y;
    let charts = worksheet
        .charts
        .iter()
        .filter_map(|chart| {
            let chart_x = worksheet.column_offset(chart.anchor.column) - origin_x;
            let chart_y = worksheet.row_offset(chart.anchor.row) - origin_y;
            let in_scrolling_view = chart_x + chart.width >= 0.0
                && chart_y + chart.height >= 0.0
                && chart_x <= viewport_width
                && chart_y <= viewport_height;
            let in_frozen_rows = chart.anchor.row < frozen_row_end
                && chart_x + chart.width >= 0.0
                && chart_x <= viewport_width;
            let in_frozen_columns = chart.anchor.column < frozen_column_end
                && chart_y + chart.height >= 0.0
                && chart_y <= viewport_height;
            (in_scrolling_view || in_frozen_rows || in_frozen_columns).then(|| DisplayChart {
                title: chart.title.clone(),
                subtitle: chart.subtitle.clone(),
                row: chart.anchor.row,
                column: chart.anchor.column,
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
        freeze: worksheet.freeze.clone(),
        show_grid_lines: worksheet.show_grid_lines,
    })
}

fn axis_union_len(frozen_end: u32, start: u32, end: u32) -> u64 {
    let overlap_start = start.min(frozen_end);
    let overlap_end = end.min(frozen_end);
    let overlap = overlap_end.saturating_sub(overlap_start);
    u64::from(frozen_end) + u64::from(end - start) - u64::from(overlap)
}

fn axis_union_ranges(frozen_end: u32, start: u32, end: u32) -> Vec<std::ops::Range<u32>> {
    if frozen_end == 0 {
        return std::iter::once(start..end).collect();
    }
    if start <= frozen_end {
        return std::iter::once(0..end.max(frozen_end)).collect();
    }
    vec![0..frozen_end, start..end]
}

fn axis_union_intersects(
    range_start: u32,
    range_end: u32,
    frozen_end: u32,
    start: u32,
    end: u32,
) -> bool {
    axis_union_ranges(frozen_end, start, end)
        .into_iter()
        .any(|axis| range_end > axis.start && range_start < axis.end)
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

    #[test]
    fn derives_ranges_from_pixel_scroll() {
        let workbook = demo_workbook();
        let viewport =
            build_viewport_for_pixels(&workbook, 0, 180.0, 120.0, 900.0, 500.0, 2).unwrap();
        assert!(viewport.column_end > viewport.column_start);
        assert!(viewport.row_end > viewport.row_start);
        assert!(viewport.cells.len() < 1_000);
    }

    #[test]
    fn carries_frozen_axes_into_scrolled_viewports() {
        let workbook = demo_workbook();
        let viewport =
            build_viewport_for_pixels(&workbook, 0, 900.0, 420.0, 900.0, 500.0, 1).unwrap();
        assert!(viewport.column_start > 0);
        assert!(viewport.row_start > 0);
        assert!(viewport.columns.iter().any(|metric| metric.index == 0));
        assert!(viewport.rows.iter().any(|metric| metric.index == 0));
        assert!(viewport.rows.iter().any(|metric| metric.index == 2));
        assert!(viewport.cells.iter().any(|cell| cell.address == "A1"));
        assert!(viewport.show_grid_lines);
    }
}
