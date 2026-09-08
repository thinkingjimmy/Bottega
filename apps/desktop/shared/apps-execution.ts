/**
 * [INPUT]: Depends only on clone-safe strings and the SHA-256 digest vocabulary
 * [OUTPUT]: Provides versioned App runtime/script commands and explicit installation strategy
 * [POS]: Shared Web/server execution description; Host adapters resolve platform entry points
 */

export type AppInstallStrategy = "author-manifest" | "agent-analysis";
export type AppCommandTarget = {
  runtime: "node" | "npm" | "pnpm" | "yarn" | "bash" | "zsh" | "pwsh";
  script?: { path: string; sha256: `sha256:${string}` };
};
type StructuredAppCommand = {
  schema: "bottega.app-command/v1";
  target: AppCommandTarget | { platforms: Record<"darwin" | "win32" | "linux", AppCommandTarget> };
  argv: string[];
  cwd: string;
  env: Record<string, { config: string } | { host: "PORT" | "HOST" | "APP_DATA_DIR" }>;
};
/** Legacy text remains valid only under its previously verified platform contract. */
export type AppCommand = string | StructuredAppCommand;
