/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayList, SheetMetadata } from "../engine/types";
import { paintWorkbook } from "./drawWorkbook";
import { WorkbookCanvas } from "./WorkbookCanvas";

vi.mock("./drawWorkbook", () => ({
  paintWorkbook: vi.fn(),
}));

const sheet: SheetMetadata = {
  name: "Dashboard",
  state: "visible",
  showGridLines: true,
  rows: 1_000,
  columns: 40,
  cellCount: 175,
  freeze: { rows: 2, columns: 1 },
};

function createDisplay(): DisplayList {
  return {
    sheetName: sheet.name,
    rowStart: 0,
    rowEnd: 100,
    columnStart: 0,
    columnEnd: 40,
    originX: 0,
    originY: 0,
    totalWidth: 4_000,
    totalHeight: 24_000,
    rows: Array.from({ length: 100 }, (_, index) => ({
      index,
      label: String(index + 1),
      offset: index * 24,
      size: 24,
    })),
    columns: Array.from({ length: 40 }, (_, index) => ({
      index,
      label: String(index + 1),
      offset: index * 100,
      size: 100,
    })),
    cells: [],
    merges: [],
    charts: [],
    styles: [],
    freeze: sheet.freeze,
    showGridLines: true,
  };
}

describe("anchored workbook canvas", () => {
  let animationFrames: FrameRequestCallback[];
  let previousScrollTo: PropertyDescriptor | undefined;

  beforeEach(() => {
    animationFrames = [];
    vi.clearAllMocks();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("PointerEvent", MouseEvent);
    previousScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    if (previousScrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", previousScrollTo);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
    }
    vi.unstubAllGlobals();
  });

  function createProps(display = createDisplay()) {
    return {
      activeSheet: 1,
      sheet,
      selected: { row: 2, column: 2 },
      zoom: 1,
      loadViewport: vi.fn(async () => display),
      onSelect: vi.fn(),
      onError: vi.fn(),
    };
  }

  async function renderCanvas(display = createDisplay()) {
    const props = createProps(display);
    const result = render(<WorkbookCanvas {...props} />);
    await waitFor(() => expect(paintWorkbook).toHaveBeenCalled());
    const grid = screen.getByRole("grid", {
      name: "Dashboard worksheet. Use arrow keys to move between cells.",
    });
    const canvas = result.container.querySelector("canvas");
    if (!canvas) throw new Error("Expected a painted workbook canvas");
    return { ...result, props, grid, canvas, display };
  }

  it("keeps the painted headers and corner outside the browser scroll layer", async () => {
    const { grid, canvas } = await renderCanvas();

    expect(grid.contains(canvas)).toBe(false);
    expect(grid.parentElement).toBe(canvas.parentElement);
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.style.transform).toBe("");
    expect(grid.getAttribute("aria-colcount")).toBe("40");
    expect(grid.getAttribute("aria-rowcount")).toBe("1000");
    expect(grid.getAttribute("tabindex")).toBe("0");
  });

  it.each([
    { direction: "vertical", x: 0, y: 320 },
    { direction: "horizontal", x: 260, y: 0 },
    { direction: "diagonal", x: 180, y: 240 },
  ])(
    "keeps the canvas anchored during active $direction scrolling before and after repaint",
    async ({ x, y }) => {
      const { grid, canvas, display } = await renderCanvas();
      vi.mocked(paintWorkbook).mockClear();

      grid.scrollLeft = x;
      grid.scrollTop = y;
      fireEvent.scroll(grid);

      expect(animationFrames).toHaveLength(1);
      expect(grid.contains(canvas)).toBe(false);
      expect(canvas.style.transform).toBe("");
      expect(paintWorkbook).not.toHaveBeenCalled();

      await act(async () => animationFrames.shift()?.(performance.now()));

      expect(grid.contains(canvas)).toBe(false);
      expect(canvas.style.transform).toBe("");
      expect(paintWorkbook).toHaveBeenLastCalledWith(
        canvas,
        display,
        expect.objectContaining({ scrollX: x, scrollY: y }),
      );
    },
  );

  it("preserves frozen panes and zoom while repainting anchored layers", async () => {
    const { rerender, props, canvas, display } = await renderCanvas();
    vi.mocked(paintWorkbook).mockClear();

    rerender(<WorkbookCanvas {...props} zoom={1.5} />);

    await waitFor(() =>
      expect(paintWorkbook).toHaveBeenLastCalledWith(
        canvas,
        expect.objectContaining({ freeze: { rows: 2, columns: 1 } }),
        expect.objectContaining({ zoom: 1.5 }),
      ),
    );
    expect(display.freeze).toEqual({ rows: 2, columns: 1 });
  });

  it("keeps selection hit testing and keyboard navigation on the accessible scroller", async () => {
    const { grid, props } = await renderCanvas();

    fireEvent.pointerDown(grid, { clientX: 195, clientY: 89 });
    expect(props.onSelect).toHaveBeenCalledWith({ row: 2, column: 1 });
    expect(document.activeElement).toBe(grid);

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(props.onSelect).toHaveBeenCalledWith({ row: 2, column: 3 });
  });

  it("coalesces repeated scroll events into one paint frame", async () => {
    const { grid, props } = await renderCanvas();
    const initialRequests = props.loadViewport.mock.calls.length;

    grid.scrollTop = 120;
    fireEvent.scroll(grid);
    grid.scrollTop = 180;
    fireEvent.scroll(grid);
    grid.scrollLeft = 80;
    fireEvent.scroll(grid);

    expect(animationFrames).toHaveLength(1);
    await act(async () => animationFrames.shift()?.(performance.now()));

    expect(paintWorkbook).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.any(Object),
      expect.objectContaining({ scrollX: 80, scrollY: 180 }),
    );
    expect(props.loadViewport).toHaveBeenCalledTimes(initialRequests);
  });

  it("cancels a pending scroll repaint when the viewer unmounts", async () => {
    const { grid, unmount } = await renderCanvas();
    grid.scrollTop = 120;
    fireEvent.scroll(grid);

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });
});
