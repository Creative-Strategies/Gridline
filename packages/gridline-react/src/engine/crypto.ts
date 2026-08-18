import { GridlineError } from "./errors";

const MAGIC = new TextEncoder().encode("GRIDLINE");
const VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 210_000;
const FIXED_HEADER_BYTES = MAGIC.length + 1 + 1 + 1 + 4 + 2 + 2;

export type GridlineEncryptedDocument = {
  blob: Blob;
  filename: string;
};

export type GridlineDecryptedDocument = {
  bytes: ArrayBuffer;
  filename?: string;
  mimeType?: string;
};

export function isGridlineEncryptedDocument(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return MAGIC.every((byte, index) => view[index] === byte);
}

export async function encryptGridlineDocument(
  input: Blob | ArrayBuffer | Uint8Array,
  password: string,
  metadata: { filename?: string; mimeType?: string } = {},
): Promise<GridlineEncryptedDocument> {
  requirePassword(password);
  const subtle = requireSubtleCrypto();
  const plaintext = await toArrayBuffer(input);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const name = new TextEncoder().encode(metadata.filename ?? "workbook.xlsx");
  const mime = new TextEncoder().encode(
    metadata.mimeType ??
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  if (name.byteLength > 65_535 || mime.byteLength > 65_535) {
    throw new GridlineError("INVALID_SOURCE", "Encrypted document metadata is too large");
  }

  const header = createHeader(salt, iv, name, mime, PBKDF2_ITERATIONS);
  const key = await derivePasswordKey(password, salt, ["encrypt"]);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: header },
    key,
    plaintext,
  );
  const output = concatenate(header, new Uint8Array(ciphertext));
  return {
    blob: new Blob([output], { type: "application/vnd.gridline.encrypted" }),
    filename: `${metadata.filename ?? "workbook.xlsx"}.gridline`,
  };
}

export async function decryptGridlineDocument(
  input: Blob | ArrayBuffer | Uint8Array,
  password: string,
): Promise<GridlineDecryptedDocument> {
  requirePassword(password);
  const bytes = new Uint8Array(await toArrayBuffer(input));
  if (!isGridlineEncryptedDocument(bytes) || bytes.byteLength < FIXED_HEADER_BYTES) {
    throw new GridlineError("UNSUPPORTED_ENCRYPTION", "Not a Gridline encrypted document");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = MAGIC.length;
  const version = view.getUint8(offset++);
  if (version !== VERSION) {
    throw new GridlineError(
      "UNSUPPORTED_ENCRYPTION",
      `Gridline encrypted document version ${version} is not supported`,
    );
  }
  const saltLength = view.getUint8(offset++);
  const ivLength = view.getUint8(offset++);
  const iterations = view.getUint32(offset, false);
  offset += 4;
  const nameLength = view.getUint16(offset, false);
  offset += 2;
  const mimeLength = view.getUint16(offset, false);
  offset += 2;
  const headerLength = offset + saltLength + ivLength + nameLength + mimeLength;
  if (
    saltLength < 8 ||
    ivLength < 12 ||
    iterations < 100_000 ||
    headerLength >= bytes.byteLength
  ) {
    throw new GridlineError("DECRYPTION_FAILED", "Encrypted document header is invalid");
  }
  const salt = bytes.slice(offset, (offset += saltLength));
  const iv = bytes.slice(offset, (offset += ivLength));
  const filename = new TextDecoder().decode(bytes.slice(offset, (offset += nameLength)));
  const mimeType = new TextDecoder().decode(bytes.slice(offset, (offset += mimeLength)));
  const header = bytes.slice(0, headerLength);
  const ciphertext = bytes.slice(headerLength);

  try {
    const key = await derivePasswordKey(password, salt, ["decrypt"], iterations);
    const decrypted = await requireSubtleCrypto().decrypt(
      { name: "AES-GCM", iv, additionalData: header },
      key,
      ciphertext,
    );
    return { bytes: decrypted, filename, mimeType };
  } catch (cause) {
    throw new GridlineError(
      "DECRYPTION_FAILED",
      "The encrypted document could not be unlocked; check the password",
      { recoverable: true, cause },
    );
  }
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  usages: KeyUsage[],
  iterations = PBKDF2_ITERATIONS,
) {
  const subtle = requireSubtleCrypto();
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.slice().buffer, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function createHeader(
  salt: Uint8Array,
  iv: Uint8Array,
  name: Uint8Array,
  mime: Uint8Array,
  iterations: number,
) {
  const header = new Uint8Array(
    FIXED_HEADER_BYTES + salt.byteLength + iv.byteLength + name.byteLength + mime.byteLength,
  );
  const view = new DataView(header.buffer);
  let offset = 0;
  header.set(MAGIC, offset);
  offset += MAGIC.length;
  view.setUint8(offset++, VERSION);
  view.setUint8(offset++, salt.byteLength);
  view.setUint8(offset++, iv.byteLength);
  view.setUint32(offset, iterations, false);
  offset += 4;
  view.setUint16(offset, name.byteLength, false);
  offset += 2;
  view.setUint16(offset, mime.byteLength, false);
  offset += 2;
  header.set(salt, offset);
  offset += salt.byteLength;
  header.set(iv, offset);
  offset += iv.byteLength;
  header.set(name, offset);
  offset += name.byteLength;
  header.set(mime, offset);
  return header;
}

function concatenate(left: Uint8Array, right: Uint8Array) {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left);
  output.set(right, left.byteLength);
  return output;
}

function requireSubtleCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new GridlineError(
      "UNSUPPORTED_ENCRYPTION",
      "Web Crypto is unavailable; use HTTPS or a secure browser context",
    );
  }
  return globalThis.crypto.subtle;
}

function requirePassword(password: string) {
  if (!password) {
    throw new GridlineError("PASSWORD_REQUIRED", "An encryption password is required", {
      recoverable: true,
    });
  }
}

async function toArrayBuffer(input: Blob | ArrayBuffer | Uint8Array) {
  if (input instanceof Blob) return input.arrayBuffer();
  if (input instanceof Uint8Array) return input.slice().buffer;
  return input.slice(0);
}
