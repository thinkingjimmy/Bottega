/**
 * [INPUT]: The shared Workspace archive catalog and the desktop locale shape
 * [OUTPUT]: Provides archiveJa, the Japanese Archive catalog
 * [POS]: Japanese leaf of shared/i18n/locales/archive; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/ja";


import type { archiveEn } from "./en";

const { sectionTitle: _sectionTitle, ...desktopArchiveCopy } = workspaceCopy.archive;

export const archiveJa: typeof archiveEn = desktopArchiveCopy;
