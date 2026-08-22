import type { WorkbookMetadata } from "../engine/types";

export type GridlineViewerMode = "full" | "compact";

export type GridlineChromeOptions = {
  topBar?: boolean;
  branding?: boolean;
  title?: boolean;
  toolbar?: boolean;
  formulaBar?: boolean;
  sheetRail?: boolean;
  sheetTabs?: boolean;
  statusBar?: boolean;
  openButton?: boolean;
  exportButton?: boolean;
  workbookMenu?: boolean;
  zoom?: boolean;
};

export type GridlineInitialSheet = string | number;

export type ResolvedGridlineChrome = Required<GridlineChromeOptions>;

const fullChrome: ResolvedGridlineChrome = {
  topBar: true,
  branding: true,
  title: true,
  toolbar: true,
  formulaBar: true,
  sheetRail: true,
  sheetTabs: true,
  statusBar: true,
  openButton: true,
  exportButton: true,
  workbookMenu: true,
  zoom: true,
};

const compactChrome: ResolvedGridlineChrome = {
  topBar: true,
  branding: false,
  title: false,
  toolbar: false,
  formulaBar: false,
  sheetRail: false,
  sheetTabs: true,
  statusBar: false,
  openButton: false,
  exportButton: false,
  workbookMenu: false,
  zoom: true,
};

export function resolveGridlineChrome(
  mode: GridlineViewerMode,
  overrides?: GridlineChromeOptions,
): ResolvedGridlineChrome {
  return { ...(mode === "compact" ? compactChrome : fullChrome), ...overrides };
}

export function resolveInitialSheet(
  metadata: WorkbookMetadata | null,
  initialSheet?: GridlineInitialSheet,
): number {
  if (!metadata || initialSheet === undefined) return 0;
  if (typeof initialSheet === "number") {
    return Number.isInteger(initialSheet) &&
      initialSheet >= 0 &&
      initialSheet < metadata.sheets.length
      ? initialSheet
      : 0;
  }

  const expected = initialSheet.trim().toLocaleLowerCase();
  if (!expected) return 0;
  const index = metadata.sheets.findIndex(
    (sheet) => sheet.name.toLocaleLowerCase() === expected,
  );
  return index < 0 ? 0 : index;
}
