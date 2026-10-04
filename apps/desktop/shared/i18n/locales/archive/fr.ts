/**
 * [INPUT]: Depends on the archiveEn structural type
 * [OUTPUT]: Provides archiveFr, the French Archive catalog
 * [POS]: French leaf of shared/i18n/locales/archive; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/fr";


import type { archiveEn } from "./en";

export const archiveFr: typeof archiveEn = { ...workspaceCopy.archive };
