"use client";

import {
  GridlineController,
  GridlineViewer,
  type GridlineControllerState,
} from "gridline-viewer";
import { useCallback, useState, useSyncExternalStore, type FormEvent } from "react";

export function PlatformClient() {
  const [controller] = useState(() => new GridlineController());
  const [url, setUrl] = useState("");
  const [authorization, setAuthorization] = useState("");
  const subscribe = useCallback(
    (notify: () => void) => controller.subscribe(() => notify()),
    [controller],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => controller.getState(),
    () => controller.getState(),
  );

  const loadCloudWorkbook = async (event: FormEvent) => {
    event.preventDefault();
    if (!url) return;
    await controller
      .open({
        type: "url",
        url,
        name: fileNameFromUrl(url),
        request: authorization
          ? { headers: { Authorization: authorization } }
          : { credentials: "include" },
      })
      .catch(() => undefined);
  };

  return (
    <div className="platform-shell">
      <aside className="platform-panel">
        <div>
          <span className="platform-kicker">Gridline platform API</span>
          <h1>Controlled workbook host</h1>
          <p>
            Load a signed cloud object, observe its lifecycle, and control the embedded viewer
            without reaching into its UI.
          </p>
        </div>

        <form onSubmit={loadCloudWorkbook}>
          <label>
            XLSX or encrypted object URL
            <input
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://cdn.example.com/plan.xlsx?..."
              type="url"
              value={url}
            />
          </label>
          <label>
            Authorization header <span>optional</span>
            <input
              autoComplete="off"
              onChange={(event) => setAuthorization(event.target.value)}
              placeholder="Bearer …"
              type="password"
              value={authorization}
            />
          </label>
          <button className="platform-primary" disabled={!url || state.status === "loading"}>
            Load from cloud
          </button>
        </form>

        <div className="platform-actions">
          <button
            disabled={!url || state.status === "loading"}
            onClick={() => void controller.reload().catch(() => undefined)}
          >
            Reload
          </button>
          <button disabled={state.status !== "loading"} onClick={() => controller.cancel()}>
            Cancel
          </button>
          <button disabled={!state.document} onClick={() => controller.downloadOriginal()}>
            Download source
          </button>
        </div>

        <PlatformState state={state} />

        <p className="platform-security-note">
          Prefer short-lived signed URLs. If a long-lived secret is required, exchange it in a
          server route and return a scoped URL; never ship service credentials to the browser.
        </p>
      </aside>
      <div className="platform-viewer-wrap">
        <GridlineViewer className="demo-viewer" controller={controller} />
      </div>
    </div>
  );
}

function PlatformState({ state }: { state: Readonly<GridlineControllerState> }) {
  return (
    <dl className="platform-state" aria-label="Viewer state">
      <div><dt>Status</dt><dd data-status={state.status}>{state.status}</dd></div>
      <div><dt>Phase</dt><dd>{state.progress?.phase ?? "—"}</dd></div>
      <div><dt>Workbook</dt><dd title={state.document?.name}>{state.document?.name ?? "Demo"}</dd></div>
      <div><dt>Sheet</dt><dd>{state.activeSheet + 1}</dd></div>
      <div><dt>Encrypted</dt><dd>{state.document?.encrypted ? "yes" : "no"}</dd></div>
      <div><dt>Cells</dt><dd>{state.metadata?.cellCount.toLocaleString() ?? "—"}</dd></div>
      {state.error ? <div><dt>Error</dt><dd title={state.error.message}>{state.error.code}</dd></div> : null}
    </dl>
  );
}

function fileNameFromUrl(value: string) {
  try {
    return new URL(value).pathname.split("/").filter(Boolean).pop() || "workbook.xlsx";
  } catch {
    return "workbook.xlsx";
  }
}
