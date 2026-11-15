/**
 * [INPUT]: The shared Workspace archive catalog and the desktop locale shape
 * [OUTPUT]: Provides archiveEn — Sidebar archive success/View/Undo feedback, unified Archive selection/restore, imported-history read-only reasons, and conditional product-owned purge/Memory rebuild copy — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/archive; recoverable lifecycle and destructive capability language are owned here rather than by source-specific copy
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/en";


const { sectionTitle: _sectionTitle, ...desktopArchiveCopy } = workspaceCopy.archive;

export const archiveEn = desktopArchiveCopy;
