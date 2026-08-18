"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type { CellCoord, CellSnapshot } from "../engine/types";
import { useWorkbookEngine } from "../engine/useWorkbookEngine";
import {
  FormulaBar,
  SheetRail,
  SheetTabs,
  StatusBar,
  Toolbar,
  TopBar,
} from "./Chrome";
import { WorkbookCanvas } from "./WorkbookCanvas";
import { cellAddress } from "./geometry";
import "./gridline.css";

export type GridlineViewerProps = {
  className?: string;
  initialFile?: File;
  initialZoom?: number;
  onError?: (error: Error) => void;
  onWorkbookOpen?: (file: File) => void;
};

const initialSelection: CellCoord = { row: 7, column: 2 };

export function GridlineViewer({
  className,
  initialFile,
  initialZoom = 1,
  onError,
  onWorkbookOpen,
}: GridlineViewerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openedInitialFileRef = useRef(false);
  const [activeSheet, setActiveSheet] = useState(0);
  const [selected, setSelected] = useState<CellCoord>(initialSelection);
  const [selectedCell, setSelectedCell] = useState<CellSnapshot | null>(null);
  const [zoom, setZoom] = useState(() => Math.max(0.5, Math.min(2, initialZoom)));
  const [railOpen, setRailOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [transientError, setTransientError] = useState<string | null>(null);
  const {
    metadata,
    status,
    error: engineError,
    openFile: engineOpenFile,
    viewport,
    cell,
    exportCsv,
  } = useWorkbookEngine(onError);

  useEffect(() => {
    if (!metadata || status === "booting") return;
    let current = true;
    cell(activeSheet, cellAddress(selected))
      .then((cell) => {
        if (current) setSelectedCell(cell);
      })
      .catch((cause) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (current) {
          setTransientError(error.message);
          onError?.(error);
        }
      });
    return () => {
      current = false;
    };
  }, [activeSheet, cell, metadata, onError, selected, status]);

  const openFile = useCallback(
    async (file: File) => {
      setTransientError(null);
      try {
        await engineOpenFile(file);
        setActiveSheet(0);
        setSelected(initialSelection);
        onWorkbookOpen?.(file);
      } catch {
        // The engine hook already exposes and reports a normalized error.
      }
    },
    [engineOpenFile, onWorkbookOpen],
  );

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) void openFile(file);
    },
    [openFile],
  );

  useEffect(() => {
    if (!initialFile || openedInitialFileRef.current || status !== "ready") {
      return;
    }
    openedInitialFileRef.current = true;
    void openFile(initialFile);
  }, [initialFile, openFile, status]);

  const handleExport = useCallback(async () => {
    if (!metadata) return;
    try {
      const csv = await exportCsv(activeSheet);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${metadata.sheets[activeSheet]?.name ?? "sheet"}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setTransientError(error.message);
      onError?.(error);
    }
  }, [activeSheet, exportCsv, metadata, onError]);

  const handleCanvasError = useCallback(
    (error: Error) => {
      setTransientError(error.message);
      onError?.(error);
    },
    [onError],
  );

  const error = transientError ?? engineError;

  return (
    <section
      className={["gridline", className].filter(Boolean).join(" ")}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="gridline__file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />
      <TopBar
        onExport={() => void handleExport()}
        onOpen={() => fileInputRef.current?.click()}
        onToggleRail={() => setRailOpen((open) => !open)}
        railOpen={railOpen}
        title={metadata?.title ?? "FY26 Operating Plan.xlsx"}
      />
      <Toolbar onZoom={setZoom} zoom={zoom} />
      <FormulaBar onSelect={setSelected} selected={selected} cell={selectedCell} />

      {metadata ? (
        <>
          <div className="gridline__workspace">
            <SheetRail
              activeSheet={activeSheet}
              onCollapse={() => setRailOpen(false)}
              onSelect={setActiveSheet}
              open={railOpen}
              sheets={metadata.sheets}
            />
            <WorkbookCanvas
              activeSheet={activeSheet}
              loadViewport={viewport}
              onError={handleCanvasError}
              onSelect={setSelected}
              selected={selected}
              sheet={metadata.sheets[activeSheet]}
              zoom={zoom}
            />
          </div>
          <SheetTabs
            activeSheet={activeSheet}
            onSelect={setActiveSheet}
            sheets={metadata.sheets}
          />
          <StatusBar
            busy={status === "loading"}
            cell={selectedCell}
            metadata={metadata}
            selected={selected}
          />
        </>
      ) : (
        <div className="gridline__boot" role="status">
          <span /> Starting local workbook engine…
        </div>
      )}

      {status === "loading" ? (
        <div className="gridline__loading-line" aria-label="Loading workbook" />
      ) : null}
      {dragging ? (
        <div className="gridline__drop-zone">
          <FolderDropMark />
          <strong>Drop workbook to open</strong>
          <span>.xlsx and .xlsm · processed locally</span>
        </div>
      ) : null}
      {error ? (
        <div className="gridline__error" role="alert">
          <span>{error}</span>
          <button onClick={() => setTransientError(null)} type="button">
            Dismiss
          </button>
        </div>
      ) : null}
    </section>
  );
}

function FolderDropMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48">
      <path d="M5 13.5A4.5 4.5 0 0 1 9.5 9h8l4 4H39a4 4 0 0 1 4 4v20H5z" />
      <path d="M24 32V20m0 0-5 5m5-5 5 5" />
    </svg>
  );
}
