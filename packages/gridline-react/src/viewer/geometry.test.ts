import { describe, expect, it } from "vitest";
import type { DisplayList } from "../engine/types";
import {
  COLUMN_HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  cellAddress,
  columnLabel,
  findAxisMetric,
  hitTestCell,
  parseCellAddress,
  viewportCovers,
} from "./geometry";

describe("spreadsheet geometry", () => {
  it("round-trips Excel addresses", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(26)).toBe("AA");
    expect(cellAddress({ row: 7, column: 2 })).toBe("C8");
    expect(parseCellAddress("$XFD$1048576")).toEqual({
      row: 1_048_575,
      column: 16_383,
    });
    expect(parseCellAddress("XFE1")).toBeNull();
  });

  it("hit-tests against WASM axis geometry", () => {
    const display = {
      originX: 0,
      originY: 0,
      columns: [
        { index: 0, label: "A", offset: 0, size: 190 },
        { index: 1, label: "B", offset: 190, size: 124 },
      ],
      rows: [
        { index: 0, label: "1", offset: 0, size: 56 },
        { index: 1, label: "2", offset: 56, size: 24 },
      ],
      freeze: { rows: 0, columns: 0 },
    } as DisplayList;
    expect(
      hitTestCell(
        display,
        ROW_HEADER_WIDTH + 200,
        COLUMN_HEADER_HEIGHT + 65,
        0,
        0,
        1,
      ),
    ).toEqual({ row: 1, column: 1 });
    expect(hitTestCell(display, 10, 10, 0, 0, 1)).toBeNull();
  });

  it("hit-tests pinned rows and columns independently from scroll", () => {
    const display = {
      originX: 640,
      originY: 240,
      columns: [
        { index: 0, label: "A", offset: -640, size: 100 },
        { index: 8, label: "I", offset: 0, size: 80 },
      ],
      rows: [
        { index: 0, label: "1", offset: -240, size: 32 },
        { index: 10, label: "11", offset: 0, size: 24 },
      ],
      freeze: { rows: 1, columns: 1 },
    } as DisplayList;

    expect(
      hitTestCell(
        display,
        ROW_HEADER_WIDTH + 50,
        COLUMN_HEADER_HEIGHT + 16,
        540,
        208,
        1,
      ),
    ).toEqual({ row: 0, column: 0 });
    expect(
      hitTestCell(
        display,
        ROW_HEADER_WIDTH + 110,
        COLUMN_HEADER_HEIGHT + 40,
        540,
        208,
        1,
      ),
    ).toEqual({ row: 10, column: 8 });
  });

  it("finds metrics logarithmically across hidden dimensions and boundaries", () => {
    const metrics = [
      { index: 0, label: "A", offset: 0, size: 40 },
      { index: 1, label: "B", offset: 40, size: 0 },
      { index: 2, label: "C", offset: 40, size: 80 },
      { index: 3, label: "D", offset: 120, size: 32 },
    ];
    expect(findAxisMetric(metrics, 0)?.index).toBe(0);
    expect(findAxisMetric(metrics, 39.99)?.index).toBe(0);
    expect(findAxisMetric(metrics, 40)?.index).toBe(2);
    expect(findAxisMetric(metrics, 119.99)?.index).toBe(2);
    expect(findAxisMetric(metrics, 120)?.index).toBe(3);
    expect(findAxisMetric(metrics, 152)).toBeUndefined();
  });

  it("reuses overscanned viewport geometry until visible cells leave its bounds", () => {
    const display = {
      originX: 100,
      originY: 240,
      totalWidth: 2_000,
      totalHeight: 4_000,
      columns: [
        { index: 0, label: "A", offset: -100, size: 100 },
        { index: 1, label: "B", offset: 0, size: 100 },
        { index: 2, label: "C", offset: 100, size: 100 },
        { index: 3, label: "D", offset: 200, size: 100 },
      ],
      rows: [
        { index: 0, label: "1", offset: -240, size: 24 },
        { index: 10, label: "11", offset: 0, size: 24 },
        { index: 11, label: "12", offset: 24, size: 24 },
        { index: 12, label: "13", offset: 48, size: 24 },
      ],
    } as DisplayList;
    const viewport = {
      sheet: 0,
      scrollX: 125,
      scrollY: 250,
      width: 150,
      height: 40,
    };

    expect(viewportCovers(display, viewport)).toBe(true);
    expect(viewportCovers(display, { ...viewport, scrollX: 90 })).toBe(false);
    expect(viewportCovers(display, { ...viewport, scrollY: 280 })).toBe(false);
    expect(viewportCovers(display, { ...viewport, width: 300 })).toBe(false);
  });

  it("does not refetch indefinitely when the viewport exceeds worksheet bounds", () => {
    const display = {
      originX: 0,
      originY: 0,
      totalWidth: 180,
      totalHeight: 80,
      columns: [{ index: 0, label: "A", offset: 0, size: 180 }],
      rows: [{ index: 0, label: "1", offset: 0, size: 80 }],
    } as DisplayList;

    expect(
      viewportCovers(display, {
        sheet: 0,
        scrollX: 0,
        scrollY: 0,
        width: 900,
        height: 520,
      }),
    ).toBe(true);
  });
});
