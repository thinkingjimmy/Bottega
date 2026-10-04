/**
 * [INPUT]: Depends on the archiveEn structural type
 * [OUTPUT]: Provides archiveEs, the Spanish Archive catalog
 * [POS]: Spanish leaf of shared/i18n/locales/archive; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/es";


import type { archiveEn } from "./en";

export const archiveEs: typeof archiveEn = { ...workspaceCopy.archive };
