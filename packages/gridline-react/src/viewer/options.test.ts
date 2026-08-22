import { describe, expect, it } from "vitest";
import type { WorkbookMetadata } from "../engine/types";
import { resolveGridlineChrome, resolveInitialSheet } from "./options";

const metadata = {
  title: "Atlas.xlsx",
  cellCount: 3_084,
  sheets: [
    { name: "Cover" },
    { name: "Dashboard" },
    { name: "Financial model" },
  ],
} as WorkbookMetadata;

describe("Gridline embedding options", () => {
  it("keeps the existing full workbook chrome by default", () => {
    expect(resolveGridlineChrome("full")).toMatchObject({
      branding: true,
      title: true,
      toolbar: true,
      formulaBar: true,
      sheetRail: true,
      sheetTabs: true,
      statusBar: true,
      zoom: true,
    });
  });

  it("keeps accessible zoom and sheet tabs while removing editor-like compact chrome", () => {
    expect(resolveGridlineChrome("compact")).toEqual({
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
    });
  });

  it("lets platform integrations independently override compact chrome", () => {
    expect(
      resolveGridlineChrome("compact", {
        branding: true,
        sheetRail: true,
        sheetTabs: false,
        exportButton: true,
      }),
    ).toMatchObject({
      branding: true,
      sheetRail: true,
      sheetTabs: false,
      exportButton: true,
      formulaBar: false,
    });
  });

  it("opens initial sheets by case-insensitive name or zero-based index", () => {
    expect(resolveInitialSheet(metadata, " Dashboard ")).toBe(1);
    expect(resolveInitialSheet(metadata, "dashboard")).toBe(1);
    expect(resolveInitialSheet(metadata, 2)).toBe(2);
  });

  it("safely falls back to the first sheet for invalid initial sheet selectors", () => {
    expect(resolveInitialSheet(metadata, "Missing")).toBe(0);
    expect(resolveInitialSheet(metadata, -1)).toBe(0);
    expect(resolveInitialSheet(metadata, 5)).toBe(0);
    expect(resolveInitialSheet(metadata, 1.5)).toBe(0);
    expect(resolveInitialSheet(null, "Dashboard")).toBe(0);
  });
});
