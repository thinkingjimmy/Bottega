/**
 * [INPUT]: Uses the verified bundled Node resolver, entry catalog and launch planner.
 * [OUTPUT]: Exports the runtime port, bundled entry/tool/guardian launch helpers and the remaining Claude ACP adapter launcher.
 * [POS]: Single Node launch authority; native Codex is an external validated executable in host custody.
 */
import { EntryCatalog } from "./entries";
import { resolveBundledNode, type BundledNode, type NodeLocation } from "./node";
import { BLANKED_NODE_ENVIRONMENT, planNodeLaunch, type NodeLaunch, type NodeLaunchRequest } from "./plan";
import { type NodeEntry, type NodePackage } from "./model";


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
