/**
 * [INPUT]: The shared Workspace archive catalog and the desktop locale shape
 * [OUTPUT]: Provides archiveFr, the French Archive catalog
 * [POS]: French leaf of shared/i18n/locales/archive; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/fr";


import type { archiveEn } from "./en";

const { sectionTitle: _sectionTitle, ...desktopArchiveCopy } = workspaceCopy.archive;

export const archiveFr: typeof archiveEn = desktopArchiveCopy;
