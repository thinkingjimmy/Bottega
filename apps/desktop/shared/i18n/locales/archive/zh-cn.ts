/**
 * [INPUT]: The shared Workspace archive catalog and the desktop locale shape
 * [OUTPUT]: Provides archiveZhCN, the Simplified Chinese Archive catalog
 * [POS]: Simplified Chinese leaf of shared/i18n/locales/archive; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/zh-cn";


import type { archiveEn } from "./en";

const { sectionTitle: _sectionTitle, ...desktopArchiveCopy } = workspaceCopy.archive;

export const archiveZhCN: typeof archiveEn = desktopArchiveCopy;
