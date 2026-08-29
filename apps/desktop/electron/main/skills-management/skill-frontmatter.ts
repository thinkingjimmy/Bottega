/**
 * [INPUT]: Depends only on SKILL.md text
 * [OUTPUT]: Provides the canonical frontmatter envelope pattern shared by catalog, import, and Extension admission
 * [POS]: Pure syntax boundary that prevents metadata parsers from importing Electron-backed catalog code
 */

export const SKILL_FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
