/**
 * [INPUT]: Depends on the resolver, the entry catalog and the planner.
 * [OUTPUT]: Provides createRuntimePort (node(): the verified bundled Node, lazily once; entryPath / packagePath: verified program paths; providerPackage: a built-in Provider package's directory and file pins; plan(): a NodeLaunch), installRuntimePort / runtimePort() (the port a composition root installed; none means nothing launches), bundledEntry (any Bottega entry on the bundled Node), bundledGuardian (the custody guardian), bundledToolsServer (the builtin MCP server a CLI starts, slice 3, with the Node variables blanked in its spec env), adapterLaunch (an ACP adapter on the bundled Node; codex-acp refused `codex-cli-missing` without a real CODEX_PATH)  and re-exports the runtime model and plan types.
 * [POS]: OPT-38's single launch owner (TASK-35). Nothing else may run the Electron executable as a Node interpreter or set its run-as-Node variable; scripts/runtime/check-run-as-node.mjs (G0) enforces it.
 */
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { EntryCatalog } from "./entries";
import { resolveBundledNode, type BundledNode, type NodeLocation } from "./node";
import { BLANKED_NODE_ENVIRONMENT, planNodeLaunch, type NodeLaunch, type NodeLaunchRequest } from "./plan";
import { LaunchRefused, type NodeEntry, type NodePackage } from "./model";


export * from "./model";
export type { BundledNode } from "./node";
export type { NodeLaunch, NodeLaunchRequest, NodeProgram } from "./plan";

export type RuntimePort = {
  node(): BundledNode;
  entryPath(entry: NodeEntry): string;
  packagePath(name: NodePackage): string;
  /** A built-in Provider package's directory and its files' pinned digests, verified by the bundled admission at startup. */
  providerPackage(providerId: string): { root: string; files: Readonly<Record<string, { sha256: string }>> };
  plan(request: NodeLaunchRequest): NodeLaunch;
};

export function createRuntimePort(location: NodeLocation & { mainDirectory: string }): RuntimePort {
  let node: BundledNode | null = null;
  const catalog = new EntryCatalog(location.mainDirectory);
  const port: RuntimePort = {
    node: () => (node ??= resolveBundledNode(location)),
    entryPath: entry => catalog.entryPath(entry),
    packagePath: name => catalog.packagePath(name),
    providerPackage: providerId => catalog.providerPackage(providerId),
    plan(request) {
      const program = request.program;
      if (program.kind === "package" && program.package === "codex-acp") assertCodexCli(request.env.CODEX_PATH, port.node().path);
      const path = program.kind === "entry" ? catalog.entryPath(program.entry) : program.kind === "package" ? catalog.packagePath(program.package) : program.script;
      return planNodeLaunch(port.node().path, path, request);
    },
  };
  return port;
}

let installed: RuntimePort | null = null;
/** The composition root installs this process's port once (runtime/app.ts for the app); null clears it. */
export function installRuntimePort(port: RuntimePort | null) { installed = port; }
/** This process's port. Nothing is launched without one: there is no fallback to the Electron executable or PATH's node. */
export function runtimePort(): RuntimePort {
  if (!installed) throw new Error("No runtime port is composed in this process; nothing can be launched on the bundled Node.");
  return installed;
}

/**
 * E4 (§2.7): codex-acp falls back to running its own bundled Codex under the interpreter when CODEX_PATH is missing. It starts only
 * with an absolute CODEX_PATH naming an existing file that is neither the bundled Node nor this app's executable.
 */
function assertCodexCli(path: string | undefined, node: string) {
  const file = path && isAbsolute(path) && existsSync(path) && statSync(path).isFile();
  if (!file || path === node || path === process.execPath) throw new LaunchRefused("codex-cli-missing", `Codex CLI not found (CODEX_PATH: ${path ?? "unset"}).`);
}

/** An ACP adapter (C2 / C3): the bundled Node on the digest-checked unpacked package, with the caller's environment filtered. */
export function adapterLaunch(name: NodePackage, env: Readonly<Record<string, string | undefined>>) {
  const { command, args, env: filtered } = runtimePort().plan({ program: { kind: "package", package: name }, args: [], env, cwd: "" });
  return { command, args, env: filtered };
}


/** A Bottega entry on the bundled Node, resolved at each call: its command and arguments (the caller adds its own). */
export function bundledEntry(entry: NodeEntry) {
  const port = runtimePort();
  return { command: port.node().path, args: ["--disable-proto=throw", port.entryPath(entry)] };
}
/** A custody guardian (§2.5). */
export const bundledGuardian = () => bundledEntry("custody-guardian");
/** The builtin MCP server a CLI is told to start (C4). The CLI launches it with whatever environment it has, so the spec blanks the
    Node variables the port strips from its own launches (E1). */
export const bundledToolsServer = () => ({ ...bundledEntry("builtin-tools-server"), env: { ...BLANKED_NODE_ENVIRONMENT } });
