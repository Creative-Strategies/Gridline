# Platform integration

Gridline can be embedded as a declarative React component or controlled by a long-lived platform controller. Every source is resolved and decrypted in the browser, then copied into an isolated Web Worker for Rust/WASM parsing.

## Declarative cloud source

Use a signed object URL, an authenticated request, or a resolver backed by your cloud SDK:

```tsx
"use client";

import { GridlineViewer, type GridlineSource } from "gridline-viewer";

const source: GridlineSource = {
  type: "url",
  url: signedUrl,
  name: "FY26-plan.xlsx",
  request: { credentials: "include" },
};

export function WorkbookPage() {
  return <GridlineViewer source={source} autoLoadDemo={false} />;
}
```

For an S3, GCS, Azure Blob, or proprietary SDK, defer resolution until the viewer starts a load. The resolver receives an `AbortSignal` and may return a `Blob`, `ArrayBuffer`, `Uint8Array`, `Response`, or a descriptor with metadata and encryption settings.

```tsx
const source: GridlineSource = {
  type: "resolver",
  name: "board-plan.xlsx",
  resolve: async ({ signal }) => {
    const signedUrl = await getShortLivedDownloadUrl({ signal });
    return fetch(signedUrl, { signal });
  },
};
```

Remote hosts must allow the embedding origin through CORS. Prefer short-lived, read-only signed URLs. Do not expose long-lived cloud credentials or service tokens to the browser. If an end user can influence the URL, enforce an origin allowlist before attaching `Authorization`, cookies, or other privileged request options; redirects should remain within the same policy.

## Platform controller

`GridlineController` provides a stable integration boundary for navigation, loading, cancellation, downloads, and state observation:

```tsx
const [controller] = useState(() => new GridlineController());

useEffect(() => controller.subscribe((state) => {
  analytics.track("workbook_state", {
    status: state.status,
    phase: state.progress?.phase,
    sheet: state.activeSheet,
  });
}), [controller]);

return <GridlineViewer controller={controller} />;
```

The controller exposes `open`, `reload`, `cancel`, `unlock`, `selectCell`, `setActiveSheet`, `setZoom`, `exportCsv`, `getOriginalBlob`, `downloadOriginal`, and `downloadEncrypted`. Loading occurs in a candidate worker so a failed or cancelled load does not corrupt the currently visible workbook.

## Encrypted documents

Gridline supports three browser-side paths:

- Password-protected Office OOXML (`.xlsx`/`.xlsm` stored in an OLE encrypted container). Standard and the common SHA-512 Agile ECMA-376 profiles are decrypted inside WASM; unsupported profiles return `UNSUPPORTED_ENCRYPTION`. A password can be supplied as `officePassword`, through `passwordProvider`, through the built-in unlock dialog, or with `controller.unlock(password)`.
- Gridline envelopes. `encryptGridlineDocument` creates a versioned AES-256-GCM container with PBKDF2-SHA-256 password derivation and authenticated filename/MIME metadata. Pass `{ encryption: { type: "gridline", password } }` to reopen it.
- Platform encryption. Use the built-in `aes-gcm` source descriptor with a Web Crypto key and IV, or a `custom` decrypt callback for KMS-wrapped keys and proprietary envelopes.

```tsx
<GridlineViewer
  source={{ type: "file", file: encryptedFile }}
  passwordProvider={async ({ document }) => vault.requestPassword(document?.name)}
/>
```

`downloadOriginal()` returns the exact bytes received from the file picker or cloud host, including encryption. `downloadEncrypted(password)` creates a portable Gridline-encrypted copy from the resolved workbook payload. Passwords are never stored in controller state or emitted through progress events.

## Limits and lifecycle

The default compressed source limit is 64 MB and is enforced against `Content-Length` before download and again while streaming. The Rust engine separately limits expanded archive data, individual parts, shared/cell text, sheets, cells, formula work/depth, CSV area/output, chart points, and viewport size. Override the source cap with `maxSourceBytes`, but keep the WASM limits in mind.

Progress moves through `resolving`, `fetching`, `decrypting`, `parsing`, and `ready`. `cancel()` aborts resolvers/fetches and terminates an in-flight candidate parser. Unmounting the viewer aborts current work and disposes both workers.
