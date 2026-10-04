/**
 * [INPUT]: Depends on node:path and the Provider contract's HomePath
 * [OUTPUT]: Provides resolveLaunchHome (the HOME a CLI launched with `env` runs with) and resolveHomePath: a descriptor-declared location resolved against an environment and that home
 * [POS]: The one reader of descriptor paths (instructions directory, skills root), main-only; replaces each provider's hand-written home resolution as callers move onto the catalog
 */
import { join, resolve } from "node:path";
import type { HomePath } from "@ai-chat/cloud-protocol/contracts/provider";

/** The HOME a CLI launched with `env` runs with: its HOME (or USERPROFILE), trimmed; else the platform home. Every descriptor path
    resolves against this, so what the host edits is what the CLI reads even when the launch environment carries its own HOME. */
export function resolveLaunchHome(env: NodeJS.ProcessEnv, platformHome: string) {
  const configured = env.HOME?.trim() || env.USERPROFILE?.trim();
  return configured ? resolve(configured) : platformHome;
}

/** The first of `path.env` that is set (trimmed), joined with its segments; else `path.home` under `userHome`. */
export function resolveHomePath(path: HomePath, env: NodeJS.ProcessEnv, userHome: string) {
  for (const candidate of path.env) {
    const value = env[candidate.name]?.trim();
    if (value) return resolve(value, ...candidate.join);
  }
  return resolve(join(userHome, ...path.home));
}
