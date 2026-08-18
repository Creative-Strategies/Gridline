"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from "react";
import { encryptGridlineDocument } from "../engine/crypto";
import type { GridlineController } from "../engine/GridlineController";
import { normalizeGridlineError, type GridlineError } from "../engine/errors";
import type {
  GridlineLoadProgress,
  GridlineSource,
} from "../engine/source";
import type {
  CellCoord,
  CellSnapshot,
  WorkbookMetadata,
} from "../engine/types";
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

export type GridlinePasswordRequest = {
  error: GridlineError;
  document: { name: string; encrypted: boolean } | null;
};

export type GridlineViewerProps = {
  className?: string;
  source?: GridlineSource;
  controller?: GridlineController;
  autoLoadDemo?: boolean;
  initialFile?: File;
  initialZoom?: number;
  maxSourceBytes?: number;
  fetcher?: typeof fetch;
  passwordProvider?: (request: GridlinePasswordRequest) => Promise<string | null>;
  onError?: (error: GridlineError) => void;
  onLoadProgress?: (progress: GridlineLoadProgress) => void;
  onWorkbookOpen?: (file: File) => void;
  onWorkbookReady?: (event: {
    metadata: WorkbookMetadata;
    source: GridlineSource;
  }) => void;
};

const initialSelection: CellCoord = { row: 7, column: 2 };

export function GridlineViewer({
  className,
  source,
  controller,
  autoLoadDemo = source ? false : true,
  initialFile,
  initialZoom = 1,
  maxSourceBytes,
  fetcher,
  passwordProvider,
  onError,
  onLoadProgress,
  onWorkbookOpen,
  onWorkbookReady,
}: GridlineViewerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openedInitialFileRef = useRef(false);
  const lastSourceRef = useRef<GridlineSource | undefined>(undefined);
  const passwordRequestRef = useRef<GridlineError | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [selected, setSelected] = useState<CellCoord>(initialSelection);
  const [selectedCell, setSelectedCell] = useState<CellSnapshot | null>(null);
  const [zoom, setZoom] = useState(() => Math.max(0.5, Math.min(2, initialZoom)));
  const [railOpen, setRailOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [transientError, setTransientError] = useState<string | null>(null);
  const [encryptionDialogOpen, setEncryptionDialogOpen] = useState(false);
  const {
    metadata,
    status,
    error: engineError,
    progress,
    document,
    openSource: engineOpenSource,
    openFile: engineOpenFile,
    reload,
    unlock,
    cancel,
    viewport,
    cell,
    exportCsv,
    clearError,
    getOriginalBlob,
    getWorkbookBlob,
  } = useWorkbookEngine({
    autoLoadDemo,
    maxSourceBytes,
    fetcher,
    onError,
    onProgress: onLoadProgress,
  });

  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setRailOpen(false);
  }, []);

  useEffect(() => {
    if (!metadata || status === "booting" || activeSheet >= metadata.sheets.length) return;
    let current = true;
    cell(activeSheet, cellAddress(selected))
      .then((snapshot) => {
        if (current) setSelectedCell(snapshot);
      })
      .catch((cause) => {
        const error = normalizeGridlineError(cause);
        if (current) {
          setTransientError(error.message);
          onError?.(error);
        }
      });
    return () => {
      current = false;
    };
  }, [activeSheet, cell, metadata, onError, selected, status]);

  const resetNavigation = useCallback(() => {
    setActiveSheet(0);
    setSelected(initialSelection);
  }, []);

  const openSource = useCallback(
    async (nextSource: GridlineSource) => {
      setTransientError(null);
      const next = await engineOpenSource(nextSource);
      resetNavigation();
      onWorkbookReady?.({ metadata: next, source: nextSource });
      return next;
    },
    [engineOpenSource, onWorkbookReady, resetNavigation],
  );

  const openFile = useCallback(
    async (file: File) => {
      setTransientError(null);
      try {
        const next = await engineOpenFile(file);
        resetNavigation();
        onWorkbookOpen?.(file);
        onWorkbookReady?.({
          metadata: next,
          source: { type: "file", file, name: file.name, mimeType: file.type },
        });
        return next;
      } catch {
        return null;
      }
    },
    [engineOpenFile, onWorkbookOpen, onWorkbookReady, resetNavigation],
  );

  useEffect(() => {
    if (!source || status === "booting" || lastSourceRef.current === source) return;
    lastSourceRef.current = source;
    void openSource(source).catch(() => undefined);
  }, [openSource, source, status]);

  useEffect(() => {
    if (!initialFile || openedInitialFileRef.current || status === "booting") return;
    openedInitialFileRef.current = true;
    void openFile(initialFile);
  }, [initialFile, openFile, status]);

  useEffect(() => {
    if (
      status !== "locked" ||
      !engineError ||
      engineError.code !== "PASSWORD_REQUIRED" ||
      !passwordProvider ||
      passwordRequestRef.current === engineError
    ) {
      return;
    }
    passwordRequestRef.current = engineError;
    let active = true;
    void passwordProvider({
      error: engineError,
      document: document ? { name: document.name, encrypted: document.encrypted } : null,
    })
      .then((password) => {
        if (active && password) void unlock(password).catch(() => undefined);
      })
      .catch((cause) => {
        if (!active) return;
        const error = normalizeGridlineError(cause);
        setTransientError(error.message);
        onError?.(error);
      });
    return () => {
      active = false;
    };
  }, [document, engineError, passwordProvider, status, unlock]);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) void openFile(file);
    },
    [openFile],
  );

  const handleExport = useCallback(
    async (sheet = activeSheet) => {
      if (!metadata) return "";
      try {
        const csv = await exportCsv(sheet);
        downloadBlob(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
          `${metadata.sheets[sheet]?.name ?? "sheet"}.csv`,
        );
        return csv;
      } catch (cause) {
        const error = normalizeGridlineError(cause);
        setTransientError(error.message);
        onError?.(error);
        throw error;
      }
    },
    [activeSheet, exportCsv, metadata, onError],
  );

  const downloadOriginal = useCallback(() => {
    const blob = getOriginalBlob();
    if (!blob || !document) return;
    downloadBlob(blob, document.name);
  }, [document, getOriginalBlob]);

  const downloadEncrypted = useCallback(
    async (password: string) => {
      const blob = getWorkbookBlob();
      if (!blob || !document) {
        throw new Error("Open a workbook before creating an encrypted download");
      }
      const encrypted = await encryptGridlineDocument(blob, password, {
        filename: document.name,
        mimeType: document.mimeType,
      });
      downloadBlob(encrypted.blob, encrypted.filename);
      return encrypted;
    },
    [document, getWorkbookBlob],
  );

  useEffect(() => {
    if (!controller) return;
    return controller.bind({
      open: openSource,
      reload,
      cancel,
      unlock,
      selectCell: setSelected,
      setActiveSheet: (sheet) => {
        if (metadata && sheet >= 0 && sheet < metadata.sheets.length) setActiveSheet(sheet);
      },
      setZoom: (next) => setZoom(Math.max(0.5, Math.min(2, next))),
      exportCsv: async (sheet = activeSheet) => exportCsv(sheet),
      getOriginalBlob,
      downloadOriginal,
      downloadEncrypted,
    });
  }, [
    activeSheet,
    cancel,
    controller,
    downloadEncrypted,
    downloadOriginal,
    exportCsv,
    getOriginalBlob,
    metadata,
    openSource,
    reload,
    unlock,
  ]);

  useEffect(() => {
    controller?.publish({
      status,
      metadata,
      progress,
      error: engineError,
      activeSheet,
      selectedCell: selected,
      zoom,
      document,
    });
  }, [activeSheet, controller, document, engineError, metadata, progress, selected, status, zoom]);

  const handleCanvasError = useCallback(
    (error: Error) => {
      const normalized = normalizeGridlineError(error);
      setTransientError(normalized.message);
      onError?.(normalized);
    },
    [onError],
  );

  const error = transientError ?? engineError?.message;

  return (
    <section
      className={["gridline", className].filter(Boolean).join(" ")}
      data-status={status}
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
        accept=".xlsx,.xlsm,.gridline,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
        canDownload={Boolean(document)}
        encrypted={document?.encrypted ?? false}
        onDownloadEncrypted={() => setEncryptionDialogOpen(true)}
        onDownloadOriginal={downloadOriginal}
        onExport={() => void handleExport()}
        onOpen={() => fileInputRef.current?.click()}
        onToggleRail={() => setRailOpen((open) => !open)}
        railOpen={railOpen}
        title={metadata?.title ?? document?.name ?? "Workbook viewer"}
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
          {status === "idle" ? (
            <button onClick={() => fileInputRef.current?.click()} type="button">
              Open a workbook
            </button>
          ) : (
            <><span /> {progressLabel(progress)}</>
          )}
        </div>
      )}

      {status === "loading" ? (
        <div
          className="gridline__loading-line"
          aria-label={progressLabel(progress)}
          style={{ "--gridline-progress": `${progress?.percent ?? 36}%` } as CSSProperties}
        />
      ) : null}
      {dragging ? (
        <div className="gridline__drop-zone">
          <FolderDropMark />
          <strong>Drop workbook to open</strong>
          <span>.xlsx, .xlsm, and encrypted Gridline files · processed locally</span>
        </div>
      ) : null}
      {status === "locked" && engineError ? (
        <PasswordDialog
          error={engineError.message}
          filename={document?.name}
          onCancel={cancel}
          onSubmit={(password) => unlock(password)}
        />
      ) : null}
      {encryptionDialogOpen ? (
        <PasswordDialog
          confirm
          filename={document?.name}
          onCancel={() => setEncryptionDialogOpen(false)}
          onSubmit={async (password) => {
            await downloadEncrypted(password);
            setEncryptionDialogOpen(false);
          }}
        />
      ) : null}
      {error && status !== "locked" ? (
        <div className="gridline__error" role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              setTransientError(null);
              clearError();
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PasswordDialog({
  filename,
  error,
  confirm = false,
  onSubmit,
  onCancel,
}: {
  filename?: string;
  error?: string;
  confirm?: boolean;
  onSubmit: (password: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || (confirm && password !== confirmation)) {
      setFormError(confirm ? "Passwords must match" : "Enter the workbook password");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onSubmit(password);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gridline__dialog-backdrop" role="presentation">
      <form aria-modal="true" className="gridline__dialog" onSubmit={submit} role="dialog">
        <div className="gridline__dialog-lock" aria-hidden="true">⌁</div>
        <h2>{confirm ? "Encrypt workbook download" : "Protected workbook"}</h2>
        <p>
          {confirm
            ? `Create an AES-256 encrypted copy of ${filename ?? "this workbook"}.`
            : `${filename ?? "This workbook"} requires a password. Decryption stays in your browser.`}
        </p>
        <label>
          Password
          <input
            autoFocus
            autoComplete={confirm ? "new-password" : "current-password"}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        {confirm ? (
          <label>
            Confirm password
            <input
              autoComplete="new-password"
              onChange={(event) => setConfirmation(event.target.value)}
              type="password"
              value={confirmation}
            />
          </label>
        ) : null}
        {formError ?? error ? <div className="gridline__dialog-error">{formError ?? error}</div> : null}
        <div className="gridline__dialog-actions">
          <button disabled={busy} onClick={onCancel} type="button">Cancel</button>
          <button className="gridline__dialog-primary" disabled={busy} type="submit">
            {busy ? "Working…" : confirm ? "Encrypt & download" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}

function progressLabel(progress: GridlineLoadProgress | null) {
  if (!progress) return "Starting local workbook engine…";
  const labels = {
    resolving: "Resolving workbook source…",
    fetching: "Downloading workbook…",
    decrypting: "Decrypting workbook locally…",
    parsing: "Parsing workbook in WebAssembly…",
    ready: "Workbook ready",
  };
  return progress.percent === undefined
    ? labels[progress.phase]
    : `${labels[progress.phase]} ${Math.round(progress.percent)}%`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function FolderDropMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48">
      <path d="M5 13.5A4.5 4.5 0 0 1 9.5 9h8l4 4H39a4 4 0 0 1 4 4v20H5z" />
      <path d="M24 32V20m0 0-5 5m5-5 5 5" />
    </svg>
  );
}
