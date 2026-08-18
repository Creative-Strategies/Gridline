import type { CellCoord, DisplayList } from "../engine/types";

export const ROW_HEADER_WIDTH = 44;
export const COLUMN_HEADER_HEIGHT = 28;

export function columnLabel(column: number) {
  let value = Math.max(0, Math.floor(column));
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function cellAddress(coord: CellCoord) {
  return `${columnLabel(coord.column)}${coord.row + 1}`;
}

export function parseCellAddress(address: string): CellCoord | null {
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})$/.exec(address.trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  const row = Number(match[2]);
  if (column > 16_384 || row > 1_048_576) return null;
  return { row: row - 1, column: column - 1 };
}

export function hitTestCell(
  display: DisplayList,
  x: number,
  y: number,
  scrollX: number,
  scrollY: number,
  zoom: number,
): CellCoord | null {
  if (x < ROW_HEADER_WIDTH || y < COLUMN_HEADER_HEIGHT) return null;
  const absoluteX = (x - ROW_HEADER_WIDTH + scrollX) / zoom;
  const absoluteY = (y - COLUMN_HEADER_HEIGHT + scrollY) / zoom;
  const column = findAxisMetric(display.columns, absoluteX - display.originX);
  const row = findAxisMetric(display.rows, absoluteY - display.originY);
  return column && row ? { row: row.index, column: column.index } : null;
}

/**
 * Finds the metric containing a local axis offset in O(log n) time.
 *
 * A viewport can contain thousands of rows when a workbook uses compact row
 * heights. Keeping hit testing logarithmic prevents pointer movement from
 * turning into a scan over every visible metric. Hidden dimensions have a
 * zero size and are deliberately skipped.
 */
export function findAxisMetric(
  metrics: DisplayList["columns"],
  offset: number,
) {
  let low = 0;
  let high = metrics.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const metric = metrics[middle];
    if (offset < metric.offset) {
      high = middle - 1;
      continue;
    }
    if (offset >= metric.offset + metric.size) {
      low = middle + 1;
      continue;
    }
    return metric.size > 0 ? metric : undefined;
  }
  return undefined;
}
