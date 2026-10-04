/**
 * [INPUT]: Depends on the archiveEn structural type
 * [OUTPUT]: Provides archiveJa, the Japanese Archive catalog
 * [POS]: Japanese leaf of shared/i18n/locales/archive; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/ja";


import type { archiveEn } from "./en";

export const archiveJa: typeof archiveEn = { ...workspaceCopy.archive };
