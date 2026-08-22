import type { CellCoord, DisplayList, PixelViewport } from "../engine/types";

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
  const frozen = frozenPaneSize(display, zoom);
  const frozenColumn =
    display.freeze.columns > 0 && x < ROW_HEADER_WIDTH + frozen.width;
  const frozenRow =
    display.freeze.rows > 0 && y < COLUMN_HEADER_HEIGHT + frozen.height;
  const absoluteX =
    (x - ROW_HEADER_WIDTH + (frozenColumn ? 0 : scrollX)) / zoom;
  const absoluteY =
    (y - COLUMN_HEADER_HEIGHT + (frozenRow ? 0 : scrollY)) / zoom;
  const column = findAxisMetric(display.columns, absoluteX - display.originX);
  const row = findAxisMetric(display.rows, absoluteY - display.originY);
  return column && row ? { row: row.index, column: column.index } : null;
}

export function frozenPaneSize(display: DisplayList, zoom: number) {
  const frozenColumn = lastFrozenMetric(
    display.columns,
    display.freeze.columns,
  );
  const frozenRow = lastFrozenMetric(display.rows, display.freeze.rows);
  return {
    width: frozenColumn
      ? (display.originX + frozenColumn.offset + frozenColumn.size) * zoom
      : 0,
    height: frozenRow
      ? (display.originY + frozenRow.offset + frozenRow.size) * zoom
      : 0,
  };
}

/** Reuse an overscanned display list until the visible window leaves its bounds. */
export function viewportCovers(display: DisplayList, viewport: PixelViewport) {
  const lastColumn = display.columns.at(-1);
  const lastRow = display.rows.at(-1);
  if (!lastColumn || !lastRow) return false;

  const right = display.originX + lastColumn.offset + lastColumn.size;
  const bottom = display.originY + lastRow.offset + lastRow.size;
  const visibleRight = Math.min(
    viewport.scrollX + viewport.width,
    display.totalWidth,
  );
  const visibleBottom = Math.min(
    viewport.scrollY + viewport.height,
    display.totalHeight,
  );
  return (
    viewport.scrollX >= display.originX &&
    viewport.scrollY >= display.originY &&
    visibleRight <= right &&
    visibleBottom <= bottom
  );
}

function lastFrozenMetric(
  metrics: DisplayList["columns"],
  frozenCount: number,
) {
  for (let index = metrics.length - 1; index >= 0; index -= 1) {
    const metric = metrics[index];
    if (metric.index < frozenCount && metric.size > 0) return metric;
  }
  return undefined;
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
