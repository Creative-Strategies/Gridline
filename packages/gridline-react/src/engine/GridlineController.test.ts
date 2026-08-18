import { describe, expect, it, vi } from "vitest";
import { GridlineController, type GridlineControllerAdapter } from "./GridlineController";

function adapter(): GridlineControllerAdapter {
  return {
    open: vi.fn(async () => ({ title: "Plan.xlsx", sheets: [], cellCount: 0 })),
    reload: vi.fn(async () => ({ title: "Plan.xlsx", sheets: [], cellCount: 0 })),
    cancel: vi.fn(),
    unlock: vi.fn(async () => ({ title: "Plan.xlsx", sheets: [], cellCount: 0 })),
    selectCell: vi.fn(),
    setActiveSheet: vi.fn(),
    setZoom: vi.fn(),
    exportCsv: vi.fn(async () => "a,b"),
    getOriginalBlob: vi.fn(() => new Blob(["xlsx"])),
    downloadOriginal: vi.fn(),
    downloadEncrypted: vi.fn(async () => ({
      blob: new Blob(["encrypted"]),
      filename: "Plan.xlsx.gridline",
    })),
  };
}

describe("GridlineController", () => {
  it("controls a mounted viewer adapter and publishes snapshots", async () => {
    const controller = new GridlineController();
    const bound = adapter();
    const unbind = controller.bind(bound);
    const listener = vi.fn();
    controller.subscribe(listener);

    await controller.open({ type: "bytes", bytes: new Uint8Array([1]) });
    controller.setActiveSheet(2);
    controller.selectCell({ row: 9, column: 4 });
    controller.publish({
      ...controller.getState(),
      status: "ready",
      activeSheet: 2,
      selectedCell: { row: 9, column: 4 },
    });

    expect(bound.open).toHaveBeenCalledOnce();
    expect(bound.setActiveSheet).toHaveBeenCalledWith(2);
    expect(bound.selectCell).toHaveBeenCalledWith({ row: 9, column: 4 });
    expect(controller.getState()).toMatchObject({ status: "ready", activeSheet: 2 });
    expect(listener).toHaveBeenLastCalledWith(controller.getState());
    unbind();
    expect(() => controller.cancel()).toThrow("not attached");
  });
});
