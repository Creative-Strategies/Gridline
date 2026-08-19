import type {
  CellSnapshot,
  DisplayList,
  PixelViewport,
  SearchMatch,
  WorkbookMetadata,
} from "./types";
import type { EngineErrorPayload } from "./errors";
import type { GRIDLINE_VERSION } from "../version";

export type GridlineWorkerVersion = typeof GRIDLINE_VERSION;

export type EngineRequest =
  | { id: number; type: "demo" }
  | { id: number; type: "open"; bytes: ArrayBuffer; password?: string }
  | { id: number; type: "viewport"; viewport: PixelViewport }
  | { id: number; type: "cell"; sheet: number; address: string }
  | { id: number; type: "search"; sheet: number; query: string; limit: number }
  | { id: number; type: "exportCsv"; sheet: number }
  | { id: number; type: "dispose" };

export type EngineRequestInput = EngineRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

export type EnginePayload =
  | WorkbookMetadata
  | DisplayList
  | CellSnapshot
  | SearchMatch[]
  | string
  | null;

export type EngineResponse =
  | {
      id: number;
      ok: true;
      payload: EnginePayload;
      workerVersion: GridlineWorkerVersion;
    }
  | {
      id: number;
      ok: false;
      error: EngineErrorPayload;
      workerVersion: GridlineWorkerVersion;
    };
