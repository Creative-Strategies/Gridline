import type { GridlineEncryptedDocument } from "./crypto";
import { GridlineError } from "./errors";
import type { GridlineLoadProgress, GridlineSource } from "./source";
import type { CellCoord, WorkbookMetadata } from "./types";

export type GridlineControllerStatus =
  | "booting"
  | "idle"
  | "loading"
  | "locked"
  | "ready"
  | "error";

export type GridlineControllerState = {
  status: GridlineControllerStatus;
  metadata: WorkbookMetadata | null;
  progress: GridlineLoadProgress | null;
  error: GridlineError | null;
  activeSheet: number;
  selectedCell: CellCoord;
  zoom: number;
  document: {
    name: string;
    mimeType: string;
    encrypted: boolean;
    size: number;
  } | null;
};

export type GridlineControllerListener = (state: Readonly<GridlineControllerState>) => void;

export type GridlineControllerAdapter = {
  open: (source: GridlineSource) => Promise<WorkbookMetadata>;
  reload: () => Promise<WorkbookMetadata>;
  cancel: () => void;
  unlock: (password: string) => Promise<WorkbookMetadata>;
  selectCell: (cell: CellCoord) => void;
  setActiveSheet: (sheet: number) => void;
  setZoom: (zoom: number) => void;
  exportCsv: (sheet?: number) => Promise<string>;
  getOriginalBlob: () => Blob | null;
  downloadOriginal: () => void;
  downloadEncrypted: (password: string) => Promise<GridlineEncryptedDocument>;
};

const DEFAULT_STATE: GridlineControllerState = {
  status: "booting",
  metadata: null,
  progress: null,
  error: null,
  activeSheet: 0,
  selectedCell: { row: 7, column: 2 },
  zoom: 1,
  document: null,
};

export class GridlineController {
  private adapter: GridlineControllerAdapter | null = null;
  private state: GridlineControllerState = DEFAULT_STATE;
  private readonly listeners = new Set<GridlineControllerListener>();

  open(source: GridlineSource) {
    return this.requireAdapter().open(source);
  }

  reload() {
    return this.requireAdapter().reload();
  }

  cancel() {
    this.requireAdapter().cancel();
  }

  unlock(password: string) {
    return this.requireAdapter().unlock(password);
  }

  selectCell(cell: CellCoord) {
    this.requireAdapter().selectCell(cell);
  }

  setActiveSheet(sheet: number) {
    this.requireAdapter().setActiveSheet(sheet);
  }

  setZoom(zoom: number) {
    this.requireAdapter().setZoom(zoom);
  }

  exportCsv(sheet?: number) {
    return this.requireAdapter().exportCsv(sheet);
  }

  getOriginalBlob() {
    return this.requireAdapter().getOriginalBlob();
  }

  downloadOriginal() {
    this.requireAdapter().downloadOriginal();
  }

  downloadEncrypted(password: string) {
    return this.requireAdapter().downloadEncrypted(password);
  }

  getState(): Readonly<GridlineControllerState> {
    return this.state;
  }

  subscribe(listener: GridlineControllerListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** @internal Used by the React host to connect the imperative platform API. */
  bind(adapter: GridlineControllerAdapter) {
    this.adapter = adapter;
    return () => {
      if (this.adapter === adapter) this.adapter = null;
    };
  }

  /** @internal Used by the React host to publish a serializable state snapshot. */
  publish(state: GridlineControllerState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private requireAdapter() {
    if (!this.adapter) {
      throw new GridlineError(
        "INVALID_SOURCE",
        "GridlineController is not attached to a mounted GridlineViewer",
        { recoverable: true },
      );
    }
    return this.adapter;
  }
}
