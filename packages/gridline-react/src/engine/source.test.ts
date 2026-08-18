import { describe, expect, it, vi } from "vitest";
import { encryptGridlineDocument } from "./crypto";
import { loadWorkbookSource } from "./source";

describe("loadWorkbookSource", () => {
  it("streams an authenticated cloud response and reports progress", async () => {
    const progress = vi.fn();
    const fetcher = vi.fn(async (_url: string | URL | Request, request?: RequestInit) => {
      expect(request?.headers).toEqual({ Authorization: "Bearer signed-token" });
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: {
          "content-length": "4",
          "content-type": "application/x-workbook",
          "content-disposition": 'attachment; filename="cloud-plan.xlsx"',
        },
      });
    });
    const result = await loadWorkbookSource(
      {
        type: "url",
        url: "https://cdn.example.test/object",
        request: { headers: { Authorization: "Bearer signed-token" } },
      },
      { signal: new AbortController().signal, fetcher, onProgress: progress },
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(result.name).toBe("cloud-plan.xlsx");
    expect(result.original.size).toBe(4);
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "fetching", loaded: 4, percent: 100 }),
    );
  });

  it("decrypts a Gridline envelope while retaining the exact encrypted bytes", async () => {
    const encrypted = await encryptGridlineDocument(
      new Uint8Array([80, 75, 3, 4]),
      "platform-secret",
      { filename: "protected.xlsx" },
    );
    const result = await loadWorkbookSource(
      {
        type: "file",
        file: encrypted.blob,
        name: encrypted.filename,
        encryption: { type: "gridline", password: "platform-secret" },
      },
      { signal: new AbortController().signal },
    );

    expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(result.name).toBe("protected.xlsx");
    expect(result.encrypted).toBe(true);
    expect(result.original.size).toBe(encrypted.blob.size);
  });

  it("rejects declared cloud objects larger than the configured limit", async () => {
    await expect(
      loadWorkbookSource(
        { type: "url", url: "https://cdn.example.test/too-large.xlsx" },
        {
          signal: new AbortController().signal,
          maxBytes: 3,
          fetcher: async () =>
            new Response(new Uint8Array([1, 2, 3, 4]), {
              headers: { "content-length": "4" },
            }),
        },
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
  });

  it("honors cancellation before invoking a cloud resolver", async () => {
    const abort = new AbortController();
    abort.abort();
    const resolve = vi.fn(async () => new Uint8Array([1]));
    await expect(
      loadWorkbookSource({ type: "resolver", resolve }, { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(resolve).not.toHaveBeenCalled();
  });
});
