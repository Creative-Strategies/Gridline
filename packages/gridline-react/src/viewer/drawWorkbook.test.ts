import { describe, expect, it } from "vitest";
import type { CellStyle, DisplayList } from "../engine/types";
import {
  MAX_CANVAS_TEXT_CHARACTERS,
  MAX_TEXT_LINES,
  MAX_TEXT_MEASUREMENTS,
  paintWorkbook,
  wrapText,
} from "./drawWorkbook";

const measure = (line: string) => line.length;

describe("canvas text layout", () => {
  it("wraps long spreadsheet labels at word boundaries", () => {
    expect(wrapText("Installed accelerator base", 12, measure)).toEqual([
      "Installed",
      "accelerator",
      "base",
    ]);
  });

  it("breaks long identifiers and adds an ellipsis when row height is limited", () => {
    expect(wrapText("CS-ATLAS-AI-FACTORY", 6, measure, 2)).toEqual([
      "CS-ATL",
      "AS-AI…",
    ]);
  });

  it("preserves explicit line breaks and supports empty cells", () => {
    expect(wrapText("first\nsecond", 20, measure)).toEqual(["first", "second"]);
    expect(wrapText("", 20, measure)).toEqual([]);
  });

  it("bounds layout work for a huge unbroken cell value", () => {
    let measurements = 0;
    const lines = wrapText(
      "X".repeat(MAX_CANVAS_TEXT_CHARACTERS * 16),
      4,
      (line) => {
        measurements += 1;
        return line.length;
      },
    );

    expect(measurements).toBeLessThanOrEqual(MAX_TEXT_MEASUREMENTS);
    expect(lines.length).toBeLessThanOrEqual(MAX_TEXT_LINES);
    expect(lines.at(-1)).toMatch(/…$/);
    expect(lines.join("").length).toBeLessThanOrEqual(MAX_CANVAS_TEXT_CHARACTERS + 1);
  });
});

describe("worksheet presentation", () => {
  it("suppresses default cell gridlines while retaining sheet chrome", () => {
    const hidden = renderWorksheet(false).lineSegments;
    const visible = renderWorksheet(true).lineSegments;

    expect(hidden.some(([, y]) => y === 120)).toBe(false);
    expect(visible.some(([, y]) => y === 120)).toBe(true);
  });

  it("paints merged headings through a frozen-column boundary", () => {
    const { texts } = renderWorksheet(true, {
      columns: [
        { index: 0, label: "A", offset: 0, size: 100 },
        { index: 1, label: "B", offset: 100, size: 100 },
      ],
      rows: [{ index: 0, label: "1", offset: 0, size: 40 }],
      cells: [
        {
          address: "A1",
          row: 0,
          column: 0,
          x: 0,
          y: 0,
          width: 200,
          height: 40,
          text: "Operating plan",
          value: { kind: "string", value: "Operating plan" },
          styleId: 0,
          merged: true,
        },
      ],
      freeze: { rows: 1, columns: 1 },
    });

    expect(texts.filter((text) => text === "Operating plan")).toHaveLength(2);
  });

  it("keeps the existing canvas backing store when repainting at the same size", () => {
    let widthWrites = 0;
    let heightWrites = 0;
    const { canvas, display } = renderWorksheet(true);
    let width = canvas.width;
    let height = canvas.height;
    Object.defineProperties(canvas, {
      width: {
        get: () => width,
        set: (value: number) => {
          width = value;
          widthWrites += 1;
        },
      },
      height: {
        get: () => height,
        set: (value: number) => {
          height = value;
          heightWrites += 1;
        },
      },
    });

    paintWorkbook(canvas, display, {
      width: 180,
      height: 120,
      scrollX: 20,
      scrollY: 0,
      zoom: 1,
      selected: { row: 2, column: 2 },
      devicePixelRatio: 1,
    });

    expect(widthWrites).toBe(0);
    expect(heightWrites).toBe(0);
  });
});

function renderWorksheet(
  showGridLines: boolean,
  overrides: Partial<DisplayList> = {},
) {
  const lineSegments: number[][] = [];
  const texts: string[] = [];
  const context = new Proxy(
    {
      measureText: (line: string) => ({ width: line.length * 7 }),
    } as unknown as CanvasRenderingContext2D,
    {
      get(target, property) {
        if (property === "lineTo") {
          return (x: number, y: number) => lineSegments.push([x, y]);
        }
        if (property === "fillText") {
          return (value: string) => texts.push(value);
        }
        const value = Reflect.get(target, property);
        if (value !== undefined) return value;
        return () => undefined;
      },
    },
  );
  const canvas = {
    style: {},
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const style: CellStyle = {
    font: {
      family: "Arial",
      size: 11,
      bold: false,
      italic: false,
      underline: false,
    },
    border: { top: {}, right: {}, bottom: {}, left: {} },
    alignment: { wrapText: false },
    numberFormat: "General",
  };
  const display = {
    sheetName: "Presentation",
    rowStart: 0,
    rowEnd: 1,
    columnStart: 0,
    columnEnd: 1,
    originX: 0,
    originY: 0,
    totalWidth: 100,
    totalHeight: 24,
    rows: [{ index: 0, label: "1", offset: 0, size: 24 }],
    columns: [{ index: 0, label: "A", offset: 0, size: 100 }],
    cells: [],
    merges: [],
    charts: [],
    styles: [style],
    freeze: { rows: 0, columns: 0 },
    showGridLines,
    ...overrides,
  } satisfies DisplayList;

  paintWorkbook(canvas, display, {
    width: 180,
    height: 120,
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    selected: { row: 2, column: 2 },
    devicePixelRatio: 1,
  });
  return { canvas, display, lineSegments, texts };
}
