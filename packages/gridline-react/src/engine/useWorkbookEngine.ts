import { useCallback, useEffect, useRef, useState } from "react";
import { WorkbookEngineClient } from "./WorkbookEngineClient";
import type {
  CellSnapshot,
  PixelViewport,
  WorkbookMetadata,
} from "./types";

export type EngineStatus = "booting" | "loading" | "ready" | "error";

export function useWorkbookEngine(onError?: (error: Error) => void) {
  const clientRef = useRef<WorkbookEngineClient | null>(null);
  const [metadata, setMetadata] = useState<WorkbookMetadata | null>(null);
  const [status, setStatus] = useState<EngineStatus>("booting");
  const [error, setError] = useState<string | null>(null);

  const reportError = useCallback(
    (cause: unknown) => {
      const next = cause instanceof Error ? cause : new Error(String(cause));
      setError(next.message);
      setStatus("error");
      onError?.(next);
      return next;
    },
    [onError],
  );

  useEffect(() => {
    const client = new WorkbookEngineClient();
    clientRef.current = client;
    let active = true;
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
    return () => {
      active = false;
      clientRef.current = null;
      client.dispose();
    };
  }, [reportError]);

  const openFile = useCallback(
    async (file: File) => {
      if (!clientRef.current) throw new Error("Gridline engine is not ready");
      if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
        throw reportError(new Error("Choose an .xlsx or .xlsm workbook"));
      }
      setStatus("loading");
      setError(null);
      try {
        const bytes = await file.arrayBuffer();
        const next = await clientRef.current.open(bytes);
        const withFileName = { ...next, title: file.name };
        setMetadata(withFileName);
        setStatus("ready");
        return withFileName;
      } catch (cause) {
        throw reportError(cause);
      }
    },
    [reportError],
  );

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
    openFile,
    viewport,
    cell,
    exportCsv,
  };
}

