/**
 * [INPUT]: The shared Workspace archive catalog and the desktop locale shape
 * [OUTPUT]: Provides archiveEs, the Spanish Archive catalog
 * [POS]: Spanish leaf of shared/i18n/locales/archive; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/es";


import type { archiveEn } from "./en";

const { sectionTitle: _sectionTitle, ...desktopArchiveCopy } = workspaceCopy.archive;

export const archiveEs: typeof archiveEn = desktopArchiveCopy;
