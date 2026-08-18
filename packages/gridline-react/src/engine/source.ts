import { decryptGridlineDocument } from "./crypto";
import { GridlineError, normalizeGridlineError } from "./errors";

export const DEFAULT_MAX_SOURCE_BYTES = 64 * 1024 * 1024;

export type GridlineLoadPhase =
  | "resolving"
  | "fetching"
  | "decrypting"
  | "parsing"
  | "ready";

export type GridlineLoadProgress = {
  phase: GridlineLoadPhase;
  loaded: number;
  total?: number;
  percent?: number;
};

export type GridlinePlatformEncryption =
  | { type: "gridline"; password: string }
  | {
      type: "aes-gcm";
      key: CryptoKey | BufferSource;
      iv: BufferSource;
      additionalData?: BufferSource;
    }
  | {
      type: "custom";
      decrypt: (bytes: ArrayBuffer, context: { signal: AbortSignal }) => Promise<BufferSource>;
    };

export type GridlineDirectSource = {
  name?: string;
  mimeType?: string;
  officePassword?: string;
  encryption?: GridlinePlatformEncryption;
};

export type GridlineSource =
  | (GridlineDirectSource & { type: "file"; file: Blob })
  | (GridlineDirectSource & {
      type: "bytes";
      bytes: Blob | ArrayBuffer | Uint8Array;
    })
  | (GridlineDirectSource & {
      type: "url";
      url: string | URL;
      request?: Omit<RequestInit, "signal">;
    })
  | {
      type: "resolver";
      name?: string;
      officePassword?: string;
      resolve: (context: { signal: AbortSignal }) => Promise<GridlineResolvedSource>;
    };

export type GridlineResolvedSource =
  | Blob
  | ArrayBuffer
  | Uint8Array
  | Response
  | (GridlineDirectSource & {
      data: Blob | ArrayBuffer | Uint8Array | Response;
    });

export type LoadedWorkbookSource = {
  bytes: ArrayBuffer;
  original: Blob;
  name: string;
  mimeType: string;
  officePassword?: string;
  encrypted: boolean;
};

export async function loadWorkbookSource(
  source: GridlineSource,
  options: {
    signal: AbortSignal;
    maxBytes?: number;
    fetcher?: typeof fetch;
    onProgress?: (progress: GridlineLoadProgress) => void;
  },
): Promise<LoadedWorkbookSource> {
  const { signal, onProgress } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  signal.throwIfAborted();
  onProgress?.({ phase: "resolving", loaded: 0 });

  if (source.type === "resolver") {
    const resolved = await source.resolve({ signal });
    signal.throwIfAborted();
    return loadResolvedSource(
      resolved,
      {
        name: source.name,
        officePassword: source.officePassword,
      },
      options,
    );
  }

  if (source.type === "url") {
    const fetcher = options.fetcher ?? globalThis.fetch;
    if (!fetcher) {
      throw new GridlineError("FETCH_FAILED", "No fetch implementation is available");
    }
    let response: Response;
    try {
      response = await fetcher(source.url, { ...source.request, signal });
    } catch (cause) {
      throw normalizeGridlineError(cause, "FETCH_FAILED");
    }
    if (!response.ok) {
      throw new GridlineError(
        "FETCH_FAILED",
        `Cloud workbook request failed (${response.status} ${response.statusText})`,
        { recoverable: true },
      );
    }
    return loadResolvedSource(response, source, options);
  }

  const data = source.type === "file" ? source.file : source.bytes;
  return loadResolvedSource(data, source, options);
}

async function loadResolvedSource(
  resolved: GridlineResolvedSource,
  inherited: GridlineDirectSource,
  options: {
    signal: AbortSignal;
    maxBytes?: number;
    onProgress?: (progress: GridlineLoadProgress) => void;
  },
): Promise<LoadedWorkbookSource> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  const descriptor = isResolvedDescriptor(resolved) ? resolved : { data: resolved };
  const name = descriptor.name ?? inherited.name ?? inferName(descriptor.data);
  const mimeType = descriptor.mimeType ?? inherited.mimeType ?? inferMimeType(descriptor.data);
  const encryption = descriptor.encryption ?? inherited.encryption;
  const officePassword = descriptor.officePassword ?? inherited.officePassword;
  const bytes = await readData(descriptor.data, maxBytes, options);
  const original = new Blob([bytes], { type: mimeType });

  let workbookBytes = bytes;
  let decryptedName = name;
  let decryptedMime = mimeType;
  if (encryption) {
    options.signal.throwIfAborted();
    options.onProgress?.({ phase: "decrypting", loaded: 0, total: bytes.byteLength });
    if (encryption.type === "gridline") {
      const decrypted = await decryptGridlineDocument(bytes, encryption.password);
      workbookBytes = decrypted.bytes;
      decryptedName = decrypted.filename ?? name.replace(/\.gridline$/i, "");
      decryptedMime = decrypted.mimeType ?? mimeType;
    } else if (encryption.type === "aes-gcm") {
      if (!globalThis.crypto?.subtle) {
        throw new GridlineError(
          "UNSUPPORTED_ENCRYPTION",
          "Web Crypto is unavailable; use HTTPS or a secure browser context",
        );
      }
      try {
        workbookBytes = await globalThis.crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: encryption.iv,
            additionalData: encryption.additionalData,
          },
          await importAesKey(encryption.key),
          bytes,
        );
      } catch (cause) {
        throw new GridlineError(
          "DECRYPTION_FAILED",
          "The cloud workbook could not be decrypted",
          { recoverable: true, cause },
        );
      }
    } else {
      const decrypted = await encryption.decrypt(bytes, { signal: options.signal });
      workbookBytes = copyBufferSource(decrypted);
    }
    enforceLimit(workbookBytes.byteLength, maxBytes);
  }

  return {
    bytes: workbookBytes,
    original,
    name: decryptedName,
    mimeType: decryptedMime,
    officePassword,
    encrypted: Boolean(encryption) || isOfficeEncrypted(bytes),
  };
}

async function readData(
  data: Blob | ArrayBuffer | Uint8Array | Response,
  maxBytes: number,
  options: {
    signal: AbortSignal;
    onProgress?: (progress: GridlineLoadProgress) => void;
  },
) {
  if (data instanceof Response) {
    if (!data.ok) {
      throw new GridlineError(
        "FETCH_FAILED",
        `Cloud workbook request failed (${data.status} ${data.statusText})`,
        { recoverable: true },
      );
    }
    const declared = Number(data.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 0) enforceLimit(declared, maxBytes);
    if (!data.body) return checkedBuffer(await data.arrayBuffer(), maxBytes);
    const reader = data.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    try {
      while (true) {
        options.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        enforceLimit(loaded, maxBytes);
        chunks.push(value);
        options.onProgress?.({
          phase: "fetching",
          loaded,
          total: declared || undefined,
          percent: declared ? Math.min(100, (loaded / declared) * 100) : undefined,
        });
      }
    } finally {
      reader.releaseLock();
    }
    const output = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output.buffer;
  }
  if (data instanceof Blob) {
    enforceLimit(data.size, maxBytes);
    options.onProgress?.({ phase: "fetching", loaded: data.size, total: data.size, percent: 100 });
    return checkedBuffer(await data.arrayBuffer(), maxBytes);
  }
  if (data instanceof Uint8Array) return checkedBuffer(data.slice().buffer, maxBytes);
  return checkedBuffer(data.slice(0), maxBytes);
}

function checkedBuffer(bytes: ArrayBuffer, maxBytes: number) {
  enforceLimit(bytes.byteLength, maxBytes);
  return bytes;
}

function enforceLimit(size: number, maxBytes: number) {
  if (size < 1 || size > maxBytes) {
    throw new GridlineError(
      "RESOURCE_LIMIT",
      `Workbook must be between 1 byte and ${Math.round(maxBytes / 1024 / 1024)} MB`,
    );
  }
}

async function importAesKey(key: CryptoKey | BufferSource) {
  if (typeof CryptoKey !== "undefined" && key instanceof CryptoKey) return key;
  if (!globalThis.crypto?.subtle) {
    throw new GridlineError(
      "UNSUPPORTED_ENCRYPTION",
      "Web Crypto is unavailable; use HTTPS or a secure browser context",
    );
  }
  return globalThis.crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [
    "decrypt",
  ]);
}

function copyBufferSource(source: BufferSource) {
  const view = source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return view.slice().buffer;
}

function isResolvedDescriptor(
  source: GridlineResolvedSource,
): source is GridlineDirectSource & { data: Blob | ArrayBuffer | Uint8Array | Response } {
  return typeof source === "object" && source !== null && "data" in source;
}

function inferName(data: Blob | ArrayBuffer | Uint8Array | Response) {
  if (data instanceof Blob && "name" in data && typeof data.name === "string") return data.name;
  if (data instanceof Response) {
    const disposition = data.headers.get("content-disposition");
    const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
    if (encoded) return decodeURIComponent(encoded);
    if (plain) return plain;
    try {
      return new URL(data.url).pathname.split("/").filter(Boolean).pop() || "workbook.xlsx";
    } catch {
      return "workbook.xlsx";
    }
  }
  return "workbook.xlsx";
}

function inferMimeType(data: Blob | ArrayBuffer | Uint8Array | Response) {
  if (data instanceof Blob && data.type) return data.type;
  if (data instanceof Response) return data.headers.get("content-type") ?? "application/octet-stream";
  return "application/octet-stream";
}

function isOfficeEncrypted(bytes: ArrayBuffer) {
  const magic = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
    (byte, index) => magic[index] === byte,
  );
}
