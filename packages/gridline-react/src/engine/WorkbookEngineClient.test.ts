import { describe, expect, it } from "vitest";
import { WorkbookEngineClient, type EngineWorker } from "./WorkbookEngineClient";
import type { EngineRequest, EngineResponse } from "./worker-protocol";
import { GRIDLINE_VERSION } from "../version";

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
  it("puts the Gridline release in the worker HTTP cache key", () => {
    const originalWorker = globalThis.Worker;
    const constructed: Array<{ options?: WorkerOptions; url: URL }> = [];
    class NativeWorkerStub {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        constructed.push({ url: new URL(scriptURL), options });
      }

      addEventListener() {}
      postMessage() {}
      terminate() {}
    }
    globalThis.Worker = NativeWorkerStub as unknown as typeof Worker;
    try {
      const client = new WorkbookEngineClient();
      expect(constructed).toHaveLength(1);
      expect(constructed[0]?.url.searchParams.get("gridline-worker")).toBe(
        GRIDLINE_VERSION,
      );
      expect(constructed[0]?.options).toMatchObject({
        name: "gridline-engine",
        type: "module",
      });
      expect(globalThis.Worker).toBe(NativeWorkerStub);
      client.dispose();
    } finally {
      globalThis.Worker = originalWorker;
    }
  });

  it("correlates worker responses", async () => {
    const worker = new FakeWorker();
    const client = new WorkbookEngineClient(worker);
    const pending = client.loadDemo();
    expect(worker.requests[0]).toMatchObject({ id: 1, type: "demo" });
    worker.respond({
      id: 1,
      ok: true,
      payload: { title: "Plan.xlsx", sheets: [], cellCount: 0 },
      workerVersion: GRIDLINE_VERSION,
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
      workerVersion: GRIDLINE_VERSION,
    });
    await expect(pending).rejects.toThrow("sheet index 99 is out of range");
    client.dispose();
  });

  it("rejects a stale worker from an earlier package release", async () => {
    const worker = new FakeWorker();
    const client = new WorkbookEngineClient(worker);
    const pending = client.loadDemo();
    worker.respond({
      id: 1,
      ok: true,
      payload: { title: "Plan.xlsx", sheets: [], cellCount: 0 },
      workerVersion: "0.2.0" as typeof GRIDLINE_VERSION,
    });
    await expect(pending).rejects.toThrow("worker version mismatch");
    client.dispose();
  });
});
