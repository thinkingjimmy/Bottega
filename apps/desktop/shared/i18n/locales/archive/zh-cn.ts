/**
 * [INPUT]: Depends on the archiveEn structural type
 * [OUTPUT]: Provides archiveZhCN, the Simplified Chinese Archive catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/archive; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/zh-cn";


import type { archiveEn } from "./en";

export const archiveZhCN: typeof archiveEn = { ...workspaceCopy.archive };
