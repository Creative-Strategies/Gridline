import { describe, expect, it } from "vitest";
import { wrapText } from "./drawWorkbook";

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
});
