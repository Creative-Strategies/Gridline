import { useCallback, useEffect, useRef, useState } from "react";
import type { GridlineControllerStatus } from "./GridlineController";
import { GridlineError, normalizeGridlineError } from "./errors";
import {
  loadWorkbookSource,
  type GridlineLoadProgress,
  type GridlineSource,
  type LoadedWorkbookSource,
} from "./source";
import type { CellSnapshot, PixelViewport, WorkbookMetadata } from "./types";
import { WorkbookEngineClient } from "./WorkbookEngineClient";

export type EngineStatus = GridlineControllerStatus;

export type UseWorkbookEngineOptions = {
  autoLoadDemo?: boolean;
  maxSourceBytes?: number;
  fetcher?: typeof fetch;
  onError?: (error: GridlineError) => void;
  onProgress?: (progress: GridlineLoadProgress) => void;
};

export function useWorkbookEngine(options: UseWorkbookEngineOptions = {}) {
  const clientRef = useRef<WorkbookEngineClient | null>(null);
  const candidateRef = useRef<WorkbookEngineClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const lastSourceRef = useRef<GridlineSource | null>(null);
  const loadedRef = useRef<LoadedWorkbookSource | null>(null);
  const onErrorRef = useRef(options.onError);
  const onProgressRef = useRef(options.onProgress);
  const [metadata, setMetadata] = useState<WorkbookMetadata | null>(null);
  const [status, setStatus] = useState<EngineStatus>("booting");
  const [error, setError] = useState<GridlineError | null>(null);
  const [progress, setProgress] = useState<GridlineLoadProgress | null>(null);
  const [document, setDocument] = useState<{
    name: string;
    mimeType: string;
    encrypted: boolean;
    size: number;
  } | null>(null);

  onErrorRef.current = options.onError;
  onProgressRef.current = options.onProgress;

  const publishProgress = useCallback((next: GridlineLoadProgress) => {
    setProgress(next);
    onProgressRef.current?.(next);
  }, []);

  const reportError = useCallback((cause: unknown) => {
    const next = normalizeGridlineError(cause);
    setError(next);
    setStatus(
      next.code === "PASSWORD_REQUIRED" || next.code === "DECRYPTION_FAILED"
        ? "locked"
        : "error",
    );
    onErrorRef.current?.(next);
    return next;
  }, []);

  useEffect(() => {
    const client = new WorkbookEngineClient();
    clientRef.current = client;
    let active = true;
    if (options.autoLoadDemo === false) {
      setStatus("idle");
    } else {
      client
        .loadDemo()
        .then((next) => {
          if (!active) return;
          setMetadata(next);
          setStatus("ready");
        })
        .catch((cause) => {
          if (active) reportError(cause);
        });
    }
    return () => {
      active = false;
      operationRef.current += 1;
      abortRef.current?.abort();
      candidateRef.current?.dispose();
      candidateRef.current = null;
      clientRef.current = null;
      client.dispose();
    };
    // Worker lifetime is intentionally independent from changing host callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parseLoaded = useCallback(
    async (loaded: LoadedWorkbookSource, password?: string) => {
      const operation = operationRef.current;
      publishProgress({
        phase: "parsing",
        loaded: loaded.bytes.byteLength,
        total: loaded.bytes.byteLength,
        percent: 100,
      });
      const candidate = new WorkbookEngineClient();
      candidateRef.current?.dispose();
      candidateRef.current = candidate;
      try {
        const next = await candidate.open(loaded.bytes.slice(0), password ?? loaded.officePassword);
        if (operation !== operationRef.current) {
          candidate.dispose();
          throw new GridlineError("ABORTED", "Workbook loading was cancelled", {
            recoverable: true,
          });
        }
        const previous = clientRef.current;
        clientRef.current = candidate;
        candidateRef.current = null;
        previous?.dispose();
        const withName = { ...next, title: loaded.name };
        setMetadata(withName);
        setDocument({
          name: loaded.name,
          mimeType: loaded.mimeType,
          encrypted: loaded.encrypted,
          size: loaded.original.size,
        });
        setError(null);
        setStatus("ready");
        publishProgress({
          phase: "ready",
          loaded: loaded.bytes.byteLength,
          total: loaded.bytes.byteLength,
          percent: 100,
        });
        return withName;
      } catch (cause) {
        if (candidateRef.current === candidate) candidateRef.current = null;
        candidate.dispose();
        throw cause;
      }
    },
    [publishProgress],
  );

  const openSource = useCallback(
    async (source: GridlineSource) => {
      const operation = ++operationRef.current;
      abortRef.current?.abort();
      candidateRef.current?.dispose();
      candidateRef.current = null;
      const abort = new AbortController();
      abortRef.current = abort;
      lastSourceRef.current = source;
      loadedRef.current = null;
      setStatus("loading");
      setError(null);
      setProgress(null);
      try {
        const loaded = await loadWorkbookSource(source, {
          signal: abort.signal,
          maxBytes: options.maxSourceBytes,
          fetcher: options.fetcher,
          onProgress: (next) => {
            if (operation === operationRef.current) publishProgress(next);
          },
        });
        if (operation !== operationRef.current) {
          throw new GridlineError("ABORTED", "Workbook loading was cancelled", {
            recoverable: true,
          });
        }
        loadedRef.current = loaded;
        setDocument({
          name: loaded.name,
          mimeType: loaded.mimeType,
          encrypted: loaded.encrypted,
          size: loaded.original.size,
        });
        return await parseLoaded(loaded);
      } catch (cause) {
        const normalized = normalizeGridlineError(cause);
        if (normalized.code === "ABORTED") throw normalized;
        throw reportError(normalized);
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
      }
    },
    [options.fetcher, options.maxSourceBytes, parseLoaded, publishProgress, reportError],
  );

  const openFile = useCallback(
    (file: File) => openSource({ type: "file", file, name: file.name, mimeType: file.type }),
    [openSource],
  );

  const reload = useCallback(() => {
    const source = lastSourceRef.current;
    if (!source) {
      return Promise.reject(
        new GridlineError("INVALID_SOURCE", "No workbook source is available to reload"),
      );
    }
    return openSource(source);
  }, [openSource]);

  const unlock = useCallback(
    async (password: string) => {
      const loaded = loadedRef.current;
      if (!loaded) {
        const source = lastSourceRef.current;
        if (source && "encryption" in source && source.encryption?.type === "gridline") {
          return openSource({
            ...source,
            encryption: { ...source.encryption, password },
          } as GridlineSource);
        }
        throw reportError(
          new GridlineError("PASSWORD_REQUIRED", "No locked workbook is waiting to be opened", {
            recoverable: true,
          }),
        );
      }
      ++operationRef.current;
      setStatus("loading");
      setError(null);
      try {
        return await parseLoaded(loaded, password);
      } catch (cause) {
        throw reportError(cause);
      }
    },
    [openSource, parseLoaded, reportError],
  );

  const cancel = useCallback(() => {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    candidateRef.current?.dispose();
    candidateRef.current = null;
    setProgress(null);
    setError(null);
    setStatus(metadata ? "ready" : "idle");
  }, [metadata]);

  const viewport = useCallback((request: PixelViewport) => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error("Gridline engine is not ready"));
    return client.viewport(request);
  }, []);

  const cell = useCallback((sheet: number, address: string) => {
    const client = clientRef.current;
    if (!client) return Promise.resolve<CellSnapshot | null>(null);
    return client.cell(sheet, address);
  }, []);

  const exportCsv = useCallback((sheet: number) => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error("Gridline engine is not ready"));
    return client.exportCsv(sheet);
  }, []);

  return {
    metadata,
    status,
    error,
    progress,
    document,
    openSource,
    openFile,
    reload,
    unlock,
    cancel,
    viewport,
    cell,
    exportCsv,
    getOriginalBlob: () => loadedRef.current?.original ?? null,
  };
}
