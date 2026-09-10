/**
 * [INPUT]: Depends on native FileReader and an optional submission/preview cancellation signal.
 * [OUTPUT]: Provides Blob-to-data-URL reading without network fetch or additional URL ownership.
 * [POS]: Shared attachment byte reader for image previews and submission encoding.
 */
export function readBlobDataUrl(
  blob: Blob,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    const finish = () => signal?.removeEventListener("abort", abort);
    reader.onload = () => {
      finish();
      resolve(String(reader.result));
    };
    reader.onerror = () => {
      finish();
      reject(reader.error ?? new Error("Attachment could not be read"));
    };
    reader.onabort = () => {
      finish();
      reject(new DOMException("Attachment read aborted", "AbortError"));
    };
    if (signal?.aborted) {
      reject(new DOMException("Attachment read aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    try {
      reader.readAsDataURL(blob);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
