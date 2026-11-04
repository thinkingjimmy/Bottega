/**
 * [INPUT]: Packaged fixed Canvas/Slides receipts and production resource bytes.
 * [OUTPUT]: Lazily verified browser assets and the separate fixed inert Slides compiler identity.
 * [POS]: Native runtime asset boundary; workspace paths and Node compiler code never enter browser leases.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
export type NativeRuntimeFormat = "canvas-dc/v3" | "slides/v4" | "design-system/v1" | "dashboard/v1";
type Output = { path: string; bytes: number; sha256: string; browser?: boolean };
const current = new Map<NativeRuntimeFormat, Promise<ReadonlyMap<string, Uint8Array>>>();
const rootFor = (format: NativeRuntimeFormat) => join(__dirname, format === "slides/v4" ? "slides-runtime" : format === "design-system/v1" ? "design-system-runtime" : format === "dashboard/v1" ? "dashboard-runtime" : "canvas-runtime");
async function receipt(format: NativeRuntimeFormat): Promise<Output[]> {
  const value = JSON.parse(await readFile(join(rootFor(format), "build.json"), "utf8"));
  if (!Array.isArray(value.outputs) || value.outputs.length > 16) throw new Error("Native editor receipt is invalid");
  return value.outputs;
}
async function verified(format: NativeRuntimeFormat, file: Output) {
  if (!/^(?:[a-zA-Z0-9_-]+\/){0,2}[a-zA-Z0-9_.-]+$/.test(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Native runtime resource identity is invalid");
  const path = join(rootFor(format), file.path), bytes = await readFile(path);
  if (bytes.length !== file.bytes || bytes.length > 32 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw new Error("Native runtime resource identity changed");
  return { path, bytes, sha256: file.sha256 };
}
export function nativeEditorAssets(format: NativeRuntimeFormat = "canvas-dc/v3"): Promise<ReadonlyMap<string, Uint8Array>> {
  let promise = current.get(format);
  if (!promise) { promise = load(format).catch(cause => { current.delete(format); throw cause; }); current.set(format, promise); }
  return promise;
}
async function load(format: NativeRuntimeFormat) {
  const result = new Map<string, Uint8Array>(); let total = 0;
  for (const file of await receipt(format)) {
    if (file.browser === false || file.path.startsWith("node/")) continue;
    const { bytes } = await verified(format, file); total += bytes.length;
    if (total > 32 * 1024 * 1024) throw new Error("Native browser resources exceed their budget");
    result.set(file.path, bytes);
  }
  if (!result.has("index.html") || !result.has("third-party-licenses.txt")) throw new Error("Native browser resources are incomplete");
  return result;
}
export async function nativeSlidesCompiler() {
  const file = (await receipt("slides/v4")).find(file => file.path === "node/compiler.cjs" && file.browser === false);
  if (!file) throw new Error("The fixed Slides compiler is unavailable");
  const { path, sha256 } = await verified("slides/v4", file);
  return { path, sha256 };
}
