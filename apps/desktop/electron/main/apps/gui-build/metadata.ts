/**
 * [INPUT]: Depends on Node crypto/fs/platform facts and fixed product dependency versions
 * [OUTPUT]: Provides canonical GUI toolchain identities, exact author imports, identity-cached payload digests, and verified legacy SDK custody
 * [POS]: apps/gui-build metadata authority; receipts, validators, and the gateway consume these values without mutable discovery
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { arch, platform } from "node:process";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";
import { bootstrapSource } from "./product-modules/bootstrap";

export const LEGACY_BASE_GUI_SDK_DIGEST =
  "sha256:f0778a3c03f7214c3ce83c52dc9b5ce6c2d2485cc9c731afa49715310ceaf4fd" as const;

export const BASE_UI_AUTHOR_SPECIFIERS = [
  "@base-ui/react/accordion",
  "@base-ui/react/alert-dialog",
  "@base-ui/react/button",
  "@base-ui/react/checkbox",
  "@base-ui/react/dialog",
  "@base-ui/react/field",
  "@base-ui/react/input",
  "@base-ui/react/menu",
  "@base-ui/react/popover",
  "@base-ui/react/progress",
  "@base-ui/react/radio",
  "@base-ui/react/radio-group",
  "@base-ui/react/scroll-area",
  "@base-ui/react/select",
  "@base-ui/react/separator",
  "@base-ui/react/switch",
  "@base-ui/react/tabs",
  "@base-ui/react/toast",
  "@base-ui/react/tooltip",
] as const;

export const PHOSPHOR_AUTHOR_SPECIFIERS = [
  "@phosphor-icons/react/ArrowLeft",
  "@phosphor-icons/react/ArrowRight",
  "@phosphor-icons/react/CaretDown",
  "@phosphor-icons/react/Check",
  "@phosphor-icons/react/DownloadSimple",
  "@phosphor-icons/react/Info",
  "@phosphor-icons/react/MagnifyingGlass",
  "@phosphor-icons/react/Plus",
  "@phosphor-icons/react/SpinnerGap",
  "@phosphor-icons/react/Trash",
  "@phosphor-icons/react/Warning",
  "@phosphor-icons/react/X",
] as const;

const CORE_AUTHOR_SPECIFIERS = [
  "react",
  "@bottega/app-react",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
] as const;
const GATE_3_AUTHOR_SPECIFIERS = [
  "@bottega/app-blocks",
  "@tanstack/react-table",
  "@tanstack/react-virtual",
  "react-hook-form",
  "zod",
  "@bottega/charts",
  "date-fns",
  "@dnd-kit/core",
  "@dnd-kit/sortable",
] as const;

export function authorPublicSpecifiers(iconLibrary: "lucide" | "phosphor") {
  return new Set<string>([
    ...CORE_AUTHOR_SPECIFIERS,
    ...BASE_UI_AUTHOR_SPECIFIERS,
    ...GATE_3_AUTHOR_SPECIFIERS,
    ...(iconLibrary === "lucide" ? ["lucide-react"] : PHOSPHOR_AUTHOR_SPECIFIERS),
  ]);
}

export const APP_GUI_DEPENDENCY_VERSIONS = Object.freeze({
  react: "19.2.4",
  reactDom: "19.2.4",
  typescript: "5.9.3",
  esbuild: "0.28.1",
  tailwindcss: "4.3.2",
  tailwindNode: "4.3.2",
  tailwindOxide: "4.3.2",
  baseUi: "1.7.0",
  lucide: "1.24.0",
  phosphor: "2.1.10",
  tanstackTable: "8.21.3",
  tanstackVirtual: "3.14.8",
  reactHookForm: "7.87.0",
  echarts: "6.1.0",
  dateFns: "4.4.0",
  dndKitCore: "6.3.1",
  dndKitSortable: "10.0.0",
});

export const TRANSFORM_CONTRACT_DIGEST = canonicalDigest({
  schema: "bottega.app-gui-transform/v1",
  preset: "bottega-react-v1",
  entryAbi: "default-zero-argument-react-component-v1",
  target: "chromium-140",
  dependencies: APP_GUI_DEPENDENCY_VERSIONS,
  publicSpecifiers: {
    core: CORE_AUTHOR_SPECIFIERS,
    baseUi: BASE_UI_AUTHOR_SPECIFIERS,
    phosphor: PHOSPHOR_AUTHOR_SPECIFIERS,
    gate3: GATE_3_AUTHOR_SPECIFIERS,
  },
  transform: {
    jsx: "automatic",
    target: "chrome140",
    format: "esm",
    splitting: true,
    minify: true,
    cssModules: "esbuild-local-css",
    tailwind: "v4-static-source-scan",
    entryNames: "[name]-[hash]",
    chunkNames: "chunk-[hash]",
    assetNames: "asset-[hash]",
  },
  productModules: {
    bootstrapCore: sha256(Buffer.from(bootstrapSource("bottega:app-entry", {
      data: false,
      preferences: false,
      workspace: false,
      workbench: false,
    }))),
  },
});

export async function platformCompilerCustodyDigest(input: Readonly<{
  compilerEntry: string;
  sandboxAdapterEntry: string;
  sandboxEvidenceDigest: string;
  nativePayloads: readonly Readonly<{ id: string; path: string }>[];
}>) {
  const payloads = await Promise.all(
    [...input.nativePayloads]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(async (payload) => ({ id: payload.id, sha256: await fileDigest(payload.path) }))
  );
  return canonicalDigest({
    schema: "bottega.app-gui-platform-custody/v1",
    platform,
    arch,
    compilerEntry: await fileDigest(input.compilerEntry),
    sandboxAdapter: await fileDigest(input.sandboxAdapterEntry),
    sandboxEvidenceDigest: input.sandboxEvidenceDigest,
    payloads,
  });
}

/* 托管摘要里最大的一块是 Electron 自身（~200MB），每次 prepare 都重读一遍会把
   一次编译的开销钉在磁盘带宽上。身份 =（size, mtimeMs），身份不变即字节不变；
   一变就重算，所以这是缓存而不是信任。 */
const fileDigests = new Map<string, Readonly<{ size: number; mtimeMs: number; digest: Sha256Digest }>>();

export async function fileDigest(path: string): Promise<Sha256Digest> {
  const identity = await stat(path);
  const cached = fileDigests.get(path);
  if (cached && cached.size === identity.size && cached.mtimeMs === identity.mtimeMs) {
    return cached.digest;
  }
  const digest = sha256(await readFile(path));
  fileDigests.set(path, { size: identity.size, mtimeMs: identity.mtimeMs, digest });
  return digest;
}

/** legacy `/_sdk/base-api.js` 的字节权威：摘要不符返回 null，调用方必须断供。 */
export async function readVerifiedLegacyBaseGuiSdk(root: string) {
  const bytes = await readFile(join(root, "base-api.js"));
  return sha256(bytes) === LEGACY_BASE_GUI_SDK_DIGEST ? bytes : null;
}

export function canonicalDigest(value: unknown): Sha256Digest {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

export function sha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    entries.sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
