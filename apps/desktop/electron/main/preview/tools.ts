/**
 * [INPUT]: An incarnation-bound tool lease, its frozen execution fence and the startup-owned feature.
 * [OUTPUT]: createPreviewToolset; start returns the canonical live-app artifact fence.
 * [POS]: Agent tool boundary; a tool cannot choose its Chat, permissions, environment or cloud identity.
 */
import { encodeArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { BuiltinToolset } from "../tools/registry";
import { previewFeature } from "./session/runtime";
export function createPreviewToolset(): BuiltinToolset {
  const feature = () => { const value = previewFeature(); if (!value || !value.consent.enabled()) throw new Error("tunnel-plugin-disabled"); return value; };
  return {
    preview_server_start: async (args, { lease, signal }) => {
      const runtime = feature(), fence = lease.previewFence;
      if (!fence) throw new Error("preview-execution-denied");
      const service = await runtime.services.start({ chatId: lease.chatId, incarnationId: lease.incarnationId, fence,
        argv: args.argv as string[], cwd: args.cwd as string, port: args.port as number, mode: args.mode as "dev" | "build",
        signal: AbortSignal.any([signal, lease.signal]) });
      void runtime.sessions.warm(service).catch(() => undefined);
      return { ...service, artifact: encodeArtifactFence({ v: 1, id: service.serverId, kind: "live-app", title: args.title as string,
        location: "session", createdAt: service.startedAt, service: { port: service.port, lifecycle: "managed", sessionId: service.serverId } }) };
    },
    preview_server_stop: async (args, { lease }) => { await feature().services.stop(args.serverId as string, lease.chatId, lease.incarnationId); return { stopped: true }; },
    preview_server_list: async (_args, { lease }) => feature().services.list(lease.chatId).filter(server => server.incarnationId === lease.incarnationId),
  };
}
