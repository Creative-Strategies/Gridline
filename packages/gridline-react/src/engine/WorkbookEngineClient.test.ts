import { describe, expect, it } from "vitest";
import { WorkbookEngineClient, type EngineWorker } from "./WorkbookEngineClient";
import type { EngineRequest, EngineResponse } from "./worker-protocol";

class FakeWorker implements EngineWorker {
  requests: EngineRequest[] = [];
  terminated = false;
  private listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message: EngineRequest) {
    this.requests.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: EngineResponse) {
    const event = { data: response } as MessageEvent<EngineResponse>;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }
}

describe("WorkbookEngineClient", () => {
  it("correlates worker responses", async () => {
    const worker = new FakeWorker();
    const client = new WorkbookEngineClient(worker);
    const pending = client.loadDemo();
    expect(worker.requests[0]).toMatchObject({ id: 1, type: "demo" });
    worker.respond({
      id: 1,
      ok: true,
      payload: { title: "Plan.xlsx", sheets: [], cellCount: 0 },
    });
    await expect(pending).resolves.toMatchObject({ title: "Plan.xlsx" });
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("surfaces engine errors", async () => {
    const worker = new FakeWorker();
    const client = new WorkbookEngineClient(worker);
    const pending = client.exportCsv(99);
    worker.respond({
      id: 1,
      ok: false,
      error: {
        code: "SHEET_OUT_OF_RANGE",
        message: "sheet index 99 is out of range",
        recoverable: false,
      },
    });
    await expect(pending).rejects.toThrow("sheet index 99 is out of range");
    client.dispose();
  });
});
