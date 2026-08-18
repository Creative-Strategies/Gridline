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
});
