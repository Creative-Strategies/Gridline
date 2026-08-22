/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridlineViewer } from "./GridlineViewer";

const engine = vi.hoisted(() => {
  const metadata = {
    title: "Atlas.xlsx",
    cellCount: 3_084,
    sheets: [
      {
        name: "Cover",
        state: "visible",
        showGridLines: true,
        rows: 100,
        columns: 26,
        cellCount: 10,
        freeze: { rows: 0, columns: 0 },
      },
      {
        name: "Dashboard",
        state: "visible",
        showGridLines: false,
        rows: 100,
        columns: 26,
        cellCount: 25,
        freeze: { rows: 0, columns: 0 },
      },
    ],
  };

  return {
    metadata,
    status: "ready" as const,
    error: null,
    progress: null,
    document: {
      name: "Atlas.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      encrypted: false,
      size: 209_240,
    },
    openSource: vi.fn(async () => metadata),
    openFile: vi.fn(async () => metadata),
    reload: vi.fn(async () => metadata),
    unlock: vi.fn(async () => metadata),
    cancel: vi.fn(),
    viewport: vi.fn(),
    cell: vi.fn(async () => null),
    exportCsv: vi.fn(async () => ""),
    clearError: vi.fn(),
    getOriginalBlob: vi.fn(() => null),
    getWorkbookBlob: vi.fn(() => null),
  };
});

vi.mock("../engine/useWorkbookEngine", () => ({
  useWorkbookEngine: () => engine,
}));

vi.mock("./WorkbookCanvas", () => ({
  WorkbookCanvas: ({
    activeSheet,
    sheet,
  }: {
    activeSheet: number;
    sheet: { name: string };
  }) => (
    <div
      aria-label={`${sheet.name} worksheet`}
      data-sheet-index={activeSheet}
      role="grid"
    />
  ),
}));

describe("GridlineViewer embedding modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("preserves the existing full workbook viewer by default", () => {
    render(<GridlineViewer />);

    expect(screen.getByLabelText("Gridline")).toBeTruthy();
    expect(screen.getByText("Atlas.xlsx")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open workbook" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
    expect(screen.getByLabelText("Cell address")).toBeTruthy();
    expect(screen.getAllByRole("navigation")).toHaveLength(2);
    expect(screen.getByRole("grid", { name: "Cover worksheet" })).toBeTruthy();
  });

  it("renders compact read-only chrome and opens Dashboard immediately", () => {
    const { container } = render(
      <GridlineViewer initialSheet="Dashboard" mode="compact" />,
    );

    expect(container.querySelector(".gridline--compact")).toBeTruthy();
    expect(screen.queryByLabelText("Gridline")).toBeNull();
    expect(screen.queryByText("Atlas.xlsx")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open workbook" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Redo" })).toBeNull();
    expect(screen.queryByLabelText("Cell address")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sheet menu" })).toBeNull();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getByRole("toolbar", { name: "Workbook zoom" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy();
    expect(screen.getByRole("grid", { name: "Dashboard worksheet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-current"))
      .toBe("page");
    expect(engine.cell).not.toHaveBeenCalled();
  });

  it("supports the defaultSheet alias and gives initialSheet precedence", () => {
    const { unmount } = render(
      <GridlineViewer defaultSheet="Dashboard" mode="compact" />,
    );
    expect(screen.getByRole("grid", { name: "Dashboard worksheet" })).toBeTruthy();

    unmount();
    render(
      <GridlineViewer
        defaultSheet="Dashboard"
        initialSheet="Cover"
        mode="compact"
      />,
    );
    expect(screen.getByRole("grid", { name: "Cover worksheet" })).toBeTruthy();
  });

  it("keeps compact sheet switching and zoom interactive", () => {
    render(<GridlineViewer mode="compact" />);

    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(screen.getByRole("grid", { name: "Dashboard worksheet" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "125%" })).toBeTruthy();
  });

  it("allows a platform to use only the accessible sheet rail", () => {
    render(
      <GridlineViewer
        chrome={{ sheetRail: true, sheetTabs: false, title: true }}
        initialSheet={1}
        mode="compact"
      />,
    );

    expect(screen.getByRole("navigation", { name: "Workbook sheets" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Sheet tabs" })).toBeNull();
    expect(screen.getByText("Atlas.xlsx")).toBeTruthy();
    expect(screen.getByRole("grid", { name: "Dashboard worksheet" })).toBeTruthy();
  });
});
