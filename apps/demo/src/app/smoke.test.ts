import { describe, expect, it } from "vitest";
import { siteDescription, siteTitle } from "./site-metadata";

describe("Gridline demo", () => {
  it("publishes workbook-viewer metadata", () => {
    expect(siteTitle).toBe("Gridline · WASM workbook viewer");
    expect(siteDescription).toContain("XLSX");
  });
});

