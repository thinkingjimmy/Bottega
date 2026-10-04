/**
 * [INPUT]: Depends on the five backend-owned locale leaves and the shared copy catalog contract.
 * [OUTPUT]: Provides openVikingCopy and everOsCopy for the registered backend descriptors and panels.
 * [POS]: Main-only localization assembly; renderer code must consume descriptor IPC instead of importing this module.
 */
import type { MemoryBackendCopyCatalog } from "../../../../../shared/ipc/content/memory-ipc";
import { backendCopyEn } from "./en";
import { backendCopyZhCN } from "./zh-cn";
import { backendCopyJa } from "./ja";
import { backendCopyFr } from "./fr";
import { backendCopyEs } from "./es";

export const openVikingCopy = { "en": backendCopyEn.openviking, "zh-CN": backendCopyZhCN.openviking, "ja": backendCopyJa.openviking, "fr": backendCopyFr.openviking, "es": backendCopyEs.openviking } satisfies MemoryBackendCopyCatalog;
export const everOsCopy = { "en": backendCopyEn.everos, "zh-CN": backendCopyZhCN.everos, "ja": backendCopyJa.everos, "fr": backendCopyFr.everos, "es": backendCopyEs.everos } satisfies MemoryBackendCopyCatalog;
