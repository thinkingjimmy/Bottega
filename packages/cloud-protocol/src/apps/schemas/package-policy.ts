/**
 * [INPUT]: Depends only on the authored App package format.
 * [OUTPUT]: Provides the single package allowlist and separate source and portable-envelope budgets.
 * [POS]: Pure policy shared by desktop filesystem inspection and cloud source verification.
 */
export const PACKAGE_ALLOWLIST = ["app.json", "app.compat.json", "README.md", "README.zh-CN.md", "LICENSE", "AGENTS.md", "CLAUDE.md",
  ".agents/skills/**", "data/base.json", "migrations/**", "gui/**", ".bottega/compiled-source-v1/**"] as const;
export const PACKAGE_BUDGET = { fileBytes: 512 * 1024, baseFileBytes: 16 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024, files: 512, depth: 6 } as const;
export const PORTABLE_SOURCE_BUDGET = { fileBytes: 16 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, files: 512, depth: 10 } as const;
