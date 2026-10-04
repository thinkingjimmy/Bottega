/**
 * [INPUT]: Depends on frozen AgentContext delivery receipts, App plan custody, ambient ProjectionLedger custody, and Chat session persistence
 * [OUTPUT]: Provides exact onSessionBound and replaceSession callbacks with compensating release across all holder authorities; a package Provider's session (no discoveries) goes straight to the Chat
 * [POS]: apps/desktop/electron/main/window/agent; Extension session handoff coordinator for main-window Agent bridge wiring; it never enumerates current inventory or workspace paths
 */

import type { SessionRef } from "../../../../shared/ipc/agent/agent-ipc";
import { builtinAgent } from "../../../../shared/chat-agent/options";
import type { AgentContext } from "../../agent/bridge/bridge-types";
import type { AppsService } from "../../apps/apps-service";
import type { ChatsService } from "../../chats/service/chats-service";
import type { AppExtensionIntegration } from "../../extensions/integration/app-extension-composition";

export function createExtensionSessionHandoff(input: {
  apps: AppsService;
  extensions: AppExtensionIntegration;
  chats: ChatsService;
}) {
  const release = (conversationId: string, session: SessionRef) => Promise.all([
    input.extensions.projections.releaseSessionDiscovery(conversationId, session),
    input.apps.thirdPartyMcpPlans.releaseSessionDiscovery(conversationId, session),
  ]);

  const onSessionBound = async (
    conversationId: string,
    session: SessionRef,
    context?: AgentContext
  ) => {
    const discoveries = context?.extensionDiscoveryBindings ?? [];
    const requestId = context?.turnProjectionInput?.requestId;
    const runtimeIdentity = context?.builtinToolPolicy?.backendRuntimeIdentity;
    const projectContext = context?.projectContext;
    if (discoveries.length && (!requestId || !runtimeIdentity || !projectContext)) {
      throw new Error("Extension session handoff 缺少 frozen turn authority");
    }
    /* Discoveries come only from a built-in's frozen turn; a package Provider's session carries none (TASK-11 S3-b). */
    const backend = builtinAgent(session.backend), bound = backend ? { ...session, backend } : null;
    if (discoveries.length && !bound) throw new Error("Extension session handoff 缺少 frozen turn authority");
    const ambient = discoveries.filter(
      (item): item is typeof item & { kind: "ambient-projection" } =>
        item.kind === "ambient-projection"
    );
    const delivered = discoveries.filter(
      (item): item is typeof item & { kind: "app-delivery"; planInstanceId: string } =>
        item.kind === "app-delivery" && Boolean(item.planInstanceId)
    );
    try {
      if (delivered.length && bound) {
        await input.apps.thirdPartyMcpPlans.handoffSession({
          requestId: requestId!,
          conversationId,
          session: bound,
          backendRuntimeIdentity: runtimeIdentity!,
          projectContext: projectContext!,
          discoveries: delivered.map((item) => ({
            deliveryInstanceId: item.authorityId,
            planInstanceId: item.planInstanceId,
            packageGenerationRef: item.packageGenerationRef,
            componentInstanceIdentity: item.componentInstanceIdentity,
            deliveryIdentity: item.deliveryIdentity,
          })),
        });
      }
      if (ambient.length && bound) {
        await input.extensions.projections.recordSessionDiscovery({
          conversationId,
          requestId: requestId!,
          backendRuntimeIdentity: runtimeIdentity!,
          projectContext: projectContext!,
          session: bound,
          discoveries: ambient,
        });
      }
      await input.chats.handleSessionBound({ conversationId }, session);
    } catch (cause) {
      await release(conversationId, session);
      throw cause;
    }
  };

  const replaceSession = async (
    conversationId: string,
    expected: SessionRef,
    next: SessionRef | null
  ) => {
    await input.chats.replaceSession({ conversationId }, expected, next);
    await release(conversationId, expected);
  };
  return { onSessionBound, replaceSession };
}
