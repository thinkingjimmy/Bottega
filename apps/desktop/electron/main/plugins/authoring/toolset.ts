/**
 * [INPUT]: Main-owned Chat incarnation/workspace resolution, plugin runtime ports and tool lease cancellation.
 * [OUTPUT]: createPluginToolset and its bounded runtime adapter contract.
 * [POS]: Plugin authoring authority boundary; callers cannot select another Chat or an arbitrary host directory.
 */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { BuiltinToolContext, BuiltinToolHandler } from "../../tools/registry";
import type { PLUGIN_TOOL_SPECS } from "../../../../shared/builtin-tools/plugins";

type Binding = Readonly<{ pluginId: string; activeGenerationId: string | null }>;
type Authority = Readonly<{ chatId: string; incarnationId: string; signal: AbortSignal; invocationId: string }>;
export interface PluginAuthoringRuntime {
  findByChat(chatId: string): Binding | null;
  install(input: Authority & { sourceRoot: string }): Promise<unknown>;
  validate(input: Authority & { pluginId: string }): Promise<unknown>;
  history(pluginId: string): Promise<unknown>;
  activate(input: Authority & { pluginId: string; generationId: string; expectedActiveGenerationId: string }): Promise<unknown>;
}
export type PluginAuthoringPorts = Readonly<{
  resolveWorkspace(chatId: string, incarnationId: string): Promise<string>;
  runtime: PluginAuthoringRuntime;
}>;

function authority(context: BuiltinToolContext): Authority {
  context.signal.throwIfAborted();
  context.lease.signal.throwIfAborted();
  return { chatId: context.lease.chatId, incarnationId: context.lease.incarnationId,
    signal: AbortSignal.any([context.signal, context.lease.signal]), invocationId: context.invocationId };
}

async function sourceDirectory(workspace: string, requested: string) {
  if (isAbsolute(requested)) throw new Error("plugin-source-outside-workspace");
  const root = await realpath(workspace);
  const source = await realpath(resolve(root, requested));
  const tail = relative(root, source);
  if (tail === ".." || tail.startsWith("../") || tail.startsWith("..\\") || isAbsolute(tail)) throw new Error("plugin-source-outside-workspace");
  const manifest = await stat(join(source, "plugin.json")).catch(() => null);
  if (!manifest?.isFile()) throw new Error("plugin-manifest-missing");
  return source;
}

export function createPluginToolset(ports: PluginAuthoringPorts): Record<(typeof PLUGIN_TOOL_SPECS)[number]["name"], BuiltinToolHandler> {
  const bound = async (context: BuiltinToolContext) => {
    const auth = authority(context);
    await ports.resolveWorkspace(auth.chatId, auth.incarnationId);
    auth.signal.throwIfAborted();
    const binding = ports.runtime.findByChat(auth.chatId);
    if (!binding) throw new Error("plugin-chat-unbound");
    return { ...auth, pluginId: binding.pluginId };
  };
  return {
    install_plugin: async (args, context) => {
      const auth = authority(context);
      const workspace = await ports.resolveWorkspace(auth.chatId, auth.incarnationId);
      const sourceRoot = await sourceDirectory(workspace, args.directory as string);
      auth.signal.throwIfAborted();
      return ports.runtime.install({ ...auth, sourceRoot });
    },
    validate_plugin: async (_args, context) => ports.runtime.validate(await bound(context)),
    plugin_versions: async (_args, context) => {
      const auth = await bound(context);
      const result = await ports.runtime.history(auth.pluginId);
      auth.signal.throwIfAborted();
      return result;
    },
    activate_plugin_version: async (args, context) => ports.runtime.activate({ ...await bound(context),
      generationId: args.generationId as string, expectedActiveGenerationId: args.expectedActiveGenerationId as string }),
  };
}
