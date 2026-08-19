import type {
  CellSnapshot,
  DisplayList,
  PixelViewport,
  SearchMatch,
  WorkbookMetadata,
} from "./types";
import type {
  EngineRequest,
  EngineRequestInput,
  EngineResponse,
} from "./worker-protocol";
import { GridlineError } from "./errors";

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

export type EngineWorker = Pick<
  Worker,
  "addEventListener" | "postMessage" | "terminate"
>;

export class WorkbookEngineClient {
  private readonly worker: EngineWorker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private disposed = false;

  constructor(worker?: EngineWorker) {
    this.worker =
      worker ??
      new Worker(new URL("./workbook.worker.js", import.meta.url), {
        type: "module",
        name: "gridline-engine",
      });
    this.worker.addEventListener("message", this.onMessage as EventListener);
    this.worker.addEventListener("error", this.onError as EventListener);
  }

  loadDemo() {
    return this.request<WorkbookMetadata>({ type: "demo" });
  }

  open(bytes: ArrayBuffer, password?: string) {
    return this.request<WorkbookMetadata>({ type: "open", bytes, password }, [bytes]);
  }

  viewport(viewport: PixelViewport) {
    return this.request<DisplayList>({ type: "viewport", viewport });
  }

  cell(sheet: number, address: string) {
    return this.request<CellSnapshot | null>({ type: "cell", sheet, address });
  }

  search(sheet: number, query: string, limit = 50) {
    return this.request<SearchMatch[]>({
      type: "search",
      sheet,
      query,
      limit,
    });
  }

  exportCsv(sheet: number) {
    return this.request<string>({ type: "exportCsv", sheet });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const id = this.nextId++;
    this.worker.postMessage({ id, type: "dispose" } satisfies EngineRequest);
    this.worker.terminate();
    this.rejectAll(new Error("Gridline engine was disposed"));
  }

  private request<T>(
    request: EngineRequestInput,
    transfer: Transferable[] = [],
  ) {
    if (this.disposed) {
      return Promise.reject(new Error("Gridline engine was disposed"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
      });
      this.worker.postMessage({ ...request, id } as EngineRequest, transfer);
    });
  }

  private readonly onMessage = (event: MessageEvent<EngineResponse>) => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      pending.reject(
        new GridlineError(response.error.code, response.error.message, {
          recoverable: response.error.recoverable,
        }),
      );
    }
  };

  private readonly onError = (event: ErrorEvent) => {
    this.rejectAll(new Error(event.message || "Gridline engine worker failed"));
  };

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
