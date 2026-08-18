export type CellCoord = { row: number; column: number };

export type CellValue =
  | { kind: "blank" }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "error"; value: string };

export type FreezePane = {
  rows: number;
  columns: number;
  topLeftCell?: string;
};

export type SheetMetadata = {
  name: string;
  state: string;
  showGridLines: boolean;
  rows: number;
  columns: number;
  cellCount: number;
  freeze: FreezePane;
};

export type WorkbookMetadata = {
  title: string;
  sheets: SheetMetadata[];
  cellCount: number;
};

export type FontStyle = {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color?: string;
};

export type BorderEdge = { style?: string; color?: string };

export type CellStyle = {
  font: FontStyle;
  fill?: string;
  border: {
    top: BorderEdge;
    right: BorderEdge;
    bottom: BorderEdge;
    left: BorderEdge;
  };
  alignment: {
    horizontal?: string;
    vertical?: string;
    wrapText: boolean;
  };
  numberFormat: string;
};

export type AxisMetric = {
  index: number;
  label: string;
  offset: number;
  size: number;
};

export type DisplayCell = {
  address: string;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  value: CellValue;
  formula?: string;
  styleId: number;
  merged: boolean;
};

export type DisplayMerge = {
  start: CellCoord;
  end: CellCoord;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplayChart = {
  title: string;
  subtitle: string;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  points: Array<{ label: string; value: number }>;
};

export type DisplayList = {
  sheetName: string;
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  originX: number;
  originY: number;
  totalWidth: number;
  totalHeight: number;
  rows: AxisMetric[];
  columns: AxisMetric[];
  cells: DisplayCell[];
  merges: DisplayMerge[];
  charts: DisplayChart[];
  styles: CellStyle[];
  freeze: FreezePane;
  showGridLines: boolean;
};

export type CellSnapshot = {
  address: string;
  row: number;
  column: number;
  value: CellValue;
  display: string;
  formula?: string;
  style: CellStyle;
};

export type SearchMatch = {
  address: string;
  row: number;
  column: number;
  text: string;
};

export type PixelViewport = {
  sheet: number;
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  overscan?: number;
};
