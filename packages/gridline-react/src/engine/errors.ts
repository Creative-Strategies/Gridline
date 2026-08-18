export type GridlineErrorCode =
  | "ABORTED"
  | "DECRYPTION_FAILED"
  | "FETCH_FAILED"
  | "INVALID_ADDRESS"
  | "INVALID_ARCHIVE"
  | "INVALID_OOXML"
  | "INVALID_SOURCE"
  | "MISSING_PART"
  | "PASSWORD_REQUIRED"
  | "RESOURCE_LIMIT"
  | "SERIALIZATION_FAILED"
  | "SHEET_OUT_OF_RANGE"
  | "UNSUPPORTED_ENCRYPTION"
  | "WORKER_FAILED"
  | "UNKNOWN";

export type EngineErrorPayload = {
  code: GridlineErrorCode;
  message: string;
  recoverable: boolean;
};

export class GridlineError extends Error {
  readonly code: GridlineErrorCode;
  readonly recoverable: boolean;

  constructor(
    code: GridlineErrorCode,
    message: string,
    options: { recoverable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GridlineError";
    this.code = code;
    this.recoverable = options.recoverable ?? false;
  }
}

export function normalizeGridlineError(
  cause: unknown,
  fallbackCode: GridlineErrorCode = "UNKNOWN",
): GridlineError {
  if (cause instanceof GridlineError) return cause;
  if (isEngineErrorPayload(cause)) {
    return new GridlineError(cause.code, cause.message, {
      recoverable: cause.recoverable,
      cause,
    });
  }
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new GridlineError("ABORTED", "Workbook loading was cancelled", {
      recoverable: true,
      cause,
    });
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new GridlineError(fallbackCode, message, { cause });
}

export function toEngineErrorPayload(cause: unknown): EngineErrorPayload {
  const normalized = normalizeGridlineError(cause, "WORKER_FAILED");
  return {
    code: normalized.code,
    message: normalized.message,
    recoverable: normalized.recoverable,
  };
}

function isEngineErrorPayload(value: unknown): value is EngineErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<EngineErrorPayload>).code === "string" &&
    typeof (value as Partial<EngineErrorPayload>).message === "string" &&
    typeof (value as Partial<EngineErrorPayload>).recoverable === "boolean"
  );
}
