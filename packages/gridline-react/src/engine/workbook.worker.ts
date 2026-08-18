/// <reference lib="webworker" />

import initWasm, { WorkbookHandle } from "gridline-core";
import type {
  EnginePayload,
  EngineRequest,
  EngineResponse,
} from "./worker-protocol";
import { toEngineErrorPayload } from "./errors";

let handle: WorkbookHandle | undefined;
let initialization: Promise<unknown> | undefined;

function ensureWasm() {
  initialization ??= initWasm();
  return initialization;
}

function requireHandle() {
  if (!handle) {
    throw new Error("No workbook is loaded");
  }
  return handle;
}

function replaceHandle(next: WorkbookHandle) {
  handle?.free();
  handle = next;
}

self.addEventListener("message", async (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  try {
    await ensureWasm();
    let payload: unknown = null;
    switch (request.type) {
      case "demo": {
        replaceHandle(WorkbookHandle.demo());
        payload = requireHandle().metadata();
        break;
      }
      case "open": {
        replaceHandle(
          WorkbookHandle.open(new Uint8Array(request.bytes), request.password),
        );
        payload = requireHandle().metadata();
        break;
      }
      case "viewport": {
        const { sheet, scrollX, scrollY, width, height, overscan = 3 } =
          request.viewport;
        payload = requireHandle().viewportAt(
          sheet,
          scrollX,
          scrollY,
          width,
          height,
          overscan,
        );
        break;
      }
      case "cell":
        payload = requireHandle().cell(request.sheet, request.address);
        break;
      case "search":
        payload = requireHandle().search(
          request.sheet,
          request.query,
          request.limit,
        );
        break;
      case "exportCsv":
        payload = requireHandle().exportCsv(request.sheet);
        break;
      case "dispose":
        handle?.free();
        handle = undefined;
        break;
    }
    self.postMessage({
      id: request.id,
      ok: true,
      payload: payload as EnginePayload,
    } satisfies EngineResponse);
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: toEngineErrorPayload(error),
    } satisfies EngineResponse);
  }
});
