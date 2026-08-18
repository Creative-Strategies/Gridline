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
  const column = display.columns.find((metric) => {
    const start = display.originX + metric.offset;
    return absoluteX >= start && absoluteX < start + metric.size;
  });
  const row = display.rows.find((metric) => {
    const start = display.originY + metric.offset;
    return absoluteY >= start && absoluteY < start + metric.size;
  });
  return column && row ? { row: row.index, column: column.index } : null;
}

