import { describe, expect, it } from "vitest";
import {
  decryptGridlineDocument,
  encryptGridlineDocument,
  isGridlineEncryptedDocument,
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
});
