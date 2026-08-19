import { describe, expect, it, vi } from "vitest";
import {
  decryptGridlineDocument,
  encryptGridlineDocument,
  isGridlineEncryptedDocument,
  MAX_PBKDF2_ITERATIONS,
} from "./crypto";
import { GridlineError } from "./errors";

describe("Gridline encrypted documents", () => {
  it("round trips bytes and authenticated metadata", async () => {
    const original = new TextEncoder().encode("xlsx payload");
    const encrypted = await encryptGridlineDocument(original, "correct horse", {
      filename: "plan.xlsx",
      mimeType: "application/x-test-workbook",
    });
    const encryptedBytes = await encrypted.blob.arrayBuffer();

    expect(isGridlineEncryptedDocument(encryptedBytes)).toBe(true);
    expect(encrypted.filename).toBe("plan.xlsx.gridline");

    const decrypted = await decryptGridlineDocument(encryptedBytes, "correct horse");
    expect(new Uint8Array(decrypted.bytes)).toEqual(original);
    expect(decrypted.filename).toBe("plan.xlsx");
    expect(decrypted.mimeType).toBe("application/x-test-workbook");
  });

  it("rejects an incorrect password with a stable code", async () => {
    const encrypted = await encryptGridlineDocument(
      new TextEncoder().encode("secret"),
      "correct",
    );
    await expect(decryptGridlineDocument(encrypted.blob, "wrong")).rejects.toMatchObject({
      code: "DECRYPTION_FAILED",
      recoverable: true,
    } satisfies Partial<GridlineError>);
  });

  it("rejects an excessive PBKDF2 work factor before deriving a key", async () => {
    const encrypted = await encryptGridlineDocument(new Uint8Array([1, 2, 3]), "correct");
    const bytes = new Uint8Array(await encrypted.blob.arrayBuffer());
    // GRIDLINE (8), version (1), salt length (1), IV length (1), iterations (4).
    new DataView(bytes.buffer).setUint32(11, MAX_PBKDF2_ITERATIONS + 1, false);
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, "deriveKey");

    await expect(decryptGridlineDocument(bytes, "correct")).rejects.toMatchObject({
      code: "DECRYPTION_FAILED",
    });
    expect(deriveKey).not.toHaveBeenCalled();
    deriveKey.mockRestore();
  });
});
