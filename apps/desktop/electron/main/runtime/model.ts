/**
 * [INPUT]: Depends on Zod.
 * [OUTPUT]: Provides the pinned bundled Node (BUNDLED_NODE: version and per-platform release digests), FETCH_SCRIPT, the closed Bottega entry names and adapter packages, the packaged runtime manifest and the build's entries manifest schemas, RuntimeUnavailable (why the bundled Node cannot be used) and LaunchRefused (why one launch is refused).
 * [POS]: The runtime launch port's vocabulary (TASK-35, OPT-38); every other runtime file and every consumer speaks it.
 */
import { z } from "zod";

/**
 * The Node the installer ships and development uses (D-RUNTIME): the version Electron 43.1.1 embeds. Per platform, the official
 * release tarball's digest and the unmodified `bin/node` digest a dev manifest must name (a signed package's binary differs and is
 * verified against its own manifest instead).
 */
export const BUNDLED_NODE = Object.freeze({
  version: "24.18.0",
  releases: Object.freeze({
    "darwin-arm64": Object.freeze({ tarballSha256: "4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6",
      nodeSha256: "ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a" }),
  } as Record<string, { tarballSha256: string; nodeSha256: string }>),
});
/** Fetches and verifies the pinned Node and writes the dev manifest (owned with the release pipeline, TASK-34). */
export const FETCH_SCRIPT = "apps/desktop/scripts/node-runtime/fetch-node.mjs";

/**
 * Bottega's own entries: each built self-contained into `out/main/<file>` (no shared chunk) and unpacked on its own, so a plain
 * Node can run it from `app.asar.unpacked/out/main/`. The file names are the ones the rest of the tree already knows.
 */
export const NODE_ENTRY_FILES = Object.freeze({
  "package-host": "package-host-entry.js",
  "package-provider": "package-provider-entry.js",
  "custody-guardian": "custody-guardian-entry.js",
  "builtin-tools-server": "builtin-tools-server.js",
  "codec-host": "codec-host-entry.js",
  "app-gui-compiler": "app-gui-compiler-entry.js",
  /* TASK-35 slice 2c: programs that used to be `-e` strings (C10, C11). */
  "process-watchdog": "process-watchdog-entry.js",
  "seatbelt-measurement": "seatbelt-measurement-entry.js",
  /* Slice 5: the App repair supervisor (C8). */
  "repair-supervisor": "repair-supervisor-entry.js",
} as const);
export type NodeEntry = keyof typeof NODE_ENTRY_FILES;

export const NODE_ENTRIES = Object.keys(NODE_ENTRY_FILES) as NodeEntry[];
/** Third-party adapters run from unpacked node_modules. */
export const NODE_PACKAGES = ["claude-agent-acp", "codex-acp"] as const;
export type NodePackage = (typeof NODE_PACKAGES)[number];

const digest = z.string().regex(/^[a-f0-9]{64}$/);
/** A path inside its root: relative, no `..` segment, no absolute or drive prefix. */
const inside = z.string().min(1).max(512).refine(value => !/^([/\\]|[A-Za-z]:)/.test(value) && !value.split(/[/\\]/).includes(".."), "outside its root");
/**
 * The `node` section scripts/node-runtime/fetch-node.mjs writes (writeManifestNodeSection). Packaged
 * (`Resources/runtime/runtime-manifest.json`): the digest of the *signed* binary at its fixed place, no `binary`. Development
 * (`apps/desktop/runtime-manifest.dev.json`, beside the output root, never packaged): `binary` names the verified cache copy.
 */
export const runtimeManifestSchema = z.object({ schemaVersion: z.literal(1).optional(),
  node: z.object({ version: z.string(), platform: z.string(), arch: z.string(), sha256: digest, bytes: z.number().int().nonnegative(),
    source: z.unknown().optional(), binary: z.string().min(1).max(4096).optional() }).strict() }).passthrough();
/** The dev manifest's file name, beside the output root (out/, out-cloud/). */
export const DEV_MANIFEST = "runtime-manifest.dev.json";
const file = z.object({ file: inside, sha256: digest, bytes: z.number().int().nonnegative() }).strict();
/** `out/main/runtime-entries.json` (inside the asar), written by the runtime entries build plugin. */
export const entriesManifestSchema = z.object({ schemaVersion: z.literal(1),
  entries: z.record(z.string(), file),
  packages: z.record(z.string(), z.object({ path: inside, sha256: digest, bytes: z.number().int().nonnegative() }).strict()),
  /* The built-in Provider packages (TASK-11 d3): each one's directory beside this manifest and every file's digest; the bridge module
     inside is the one a Provider's bridge evaluates, from verified bytes only. */
  providerPackages: z.record(z.string(), z.object({ directory: inside,
    files: z.record(z.string(), z.object({ sha256: digest, bytes: z.number().int().nonnegative() }).strict()) }).strict()).optional() }).strict();
export type EntriesManifest = z.infer<typeof entriesManifestSchema>;

export type RuntimeUnavailableReason = "missing" | "digest-mismatch" | "platform-mismatch" | "version-mismatch" | "manifest-invalid" | "dev-cache-missing";
export class RuntimeUnavailable extends Error {
  constructor(readonly reason: RuntimeUnavailableReason, message: string) { super(message); this.name = "RuntimeUnavailable"; }
}
/** `codex-cli-missing` (E4): codex-acp without a real Codex CLI in CODEX_PATH would run its own bundled Codex under Node. */
export type LaunchRefusal = "entry-missing" | "entry-digest-mismatch" | "package-unknown" | "inspect-flag" | "require-flag" | "eval-flag" | "codex-cli-missing";
export class LaunchRefused extends Error {
  constructor(readonly code: LaunchRefusal, message: string) { super(message); this.name = "LaunchRefused"; }
}
