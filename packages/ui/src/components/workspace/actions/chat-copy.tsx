/**
 * [INPUT]: No runtime dependencies; Selected workspace presentation vocabulary.
 * [OUTPUT]: Provides workspaceCopy for shared Chat actions, Project settings and Archive.
 * [POS]: Language leaf imported directly by desktop and selected by Web.
 */
import { workspaceCopy } from "../copy";
export const sidebarActionCopy = (locale: string) => workspaceCopy(locale).chat;
