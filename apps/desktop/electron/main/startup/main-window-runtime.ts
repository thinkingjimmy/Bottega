/**
 * [INPUT]: Depends on the main-window combination parameters, AppsService, effective-workspace resolver, system Skill resources, BuiltinToolRegistry, and chat incarnation reader
 * [OUTPUT]: Provides reusable main window launcher and environment-gated Browser/App/Design E2E drivers, including exact Gateway lease evidence plus request-bound Design settlement, suppression, and explicit-$design lifecycle probes
 * [POS]: The startup window is separated from the E2E combination layer; Remove the parameter duplication of the activate path, E2E rebuild Reuse production explicit generation cutover, no service lifecycle
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILTIN_TOOL_SPECS,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import type { AppsService } from "../apps/apps-service";
import type { EffectiveWorkspaceResolver } from "../workspace-resolver";
import type { BuiltinMcpLease } from "../tools/lease";
import type { BuiltinToolRegistry } from "../tools/registry";
import { toBuiltinCallToolResult } from "../tools/result";
import { createMainWindow } from "../window/main-window";
import { systemSkillsPath } from "../system-skills";

export function createMainWindowLauncher(
  options: Parameters<typeof createMainWindow>[0]
) {
  return () => createMainWindow(options);
}

type BrowserE2eDriver = {
  call(chatId: string, tool: BuiltinToolName, args: unknown): Promise<unknown>;
};

type AppGuiE2eDriver = {
  rebuild(appId: string, conversationId: string): Promise<void>;
  gatewayRequests(appId: string): Readonly<{ total: number; generations: readonly Readonly<{ generationId: string; count: number }>[]; evidence: readonly unknown[] }>;
};

type DesignE2eDriver = {
  produce(input: {
    chatId: string;
    conversationIncarnationId: string;
    turnId: string;
    html: string;
    file?: string;
  }): Promise<{
    appId: string;
    dataCustodyId: string;
    file: string;
    skillContent: string;
    stableWorkspaceOwnerId: string;
    workspaceOwnerKind: string;
  }>;
  suppressed(input: {
    chatId: string;
    conversationIncarnationId: string;
  }): boolean;
  clearExplicit(input: {
    chatId: string;
    conversationIncarnationId: string;
    turnId: string;
  }): Promise<boolean>;
  render(input: {
    chatId: string;
    file: string;
    viewport: "desktop" | "tablet" | "mobile";
  }): Promise<unknown>;
};

export function installAppGuiE2eDriver(service: AppsService) {
  if (process.env.AI_CHAT_APP_GUI_E2E !== "1") return;
  const scope = globalThis as typeof globalThis & {
    __aiChatAppGuiE2E?: AppGuiE2eDriver;
  };
  scope.__aiChatAppGuiE2E = {
    gatewayRequests(appId) {
      const record = service.store.get(appId);
      return {
        total: service.gatewayRequestLeases.countApp(appId),
        evidence: service.gatewayRequestLeases.evidence(appId),
        generations: record?.generations.map(({ generationId }) => ({
          generationId,
          count: service.gatewayRequestLeases.count(appId, generationId).count,
        })) ?? [],
      };
    },
    async rebuild(appId, conversationId) {
      await service.onAppTurnCompleted(
        appId,
        conversationId,
        `gui-e2e-${randomUUID()}`
      );
    },
  };
}

export function installDesignE2eDriver(
  service: AppsService,
  resolveEffectiveWorkspace: EffectiveWorkspaceResolver,
  registry: BuiltinToolRegistry,
  getIncarnationId: (chatId: string) => string | undefined
) {
  if (process.env.AI_CHAT_DESIGN_E2E !== "1") return;
  const scope = globalThis as typeof globalThis & {
    __aiChatDesignE2E?: DesignE2eDriver;
  };
  scope.__aiChatDesignE2E = {
    async produce(input) {
      await service.ensureDesignFactory();
      const appId = service.design.enabled.enabledAppId();
      const data = appId ? service.design.resolveAppData(appId) : undefined;
      if (!appId || !data) throw new Error("Design E2E factory 未就绪");
      const file = input.file ?? "design/e2e-canvas.html";
      const effective = resolveEffectiveWorkspace({
        kind: "conversation",
        conversationId: input.chatId,
      });
      if (effective.kind !== "ready") throw new Error(effective.message);
      const previousVersions = service.design.history.list(
        effective.stableWorkspaceOwnerId,
        file
      ).length;
      const armed = await service.armDesignTurn({
        ...input,
        explicitDesign: false,
      });
      if (!armed) throw new Error("Design E2E turn 未经 production workspace arm");
      await mkdir(join(effective.workspace, "design"), { recursive: true });
      await writeFile(join(effective.workspace, file), input.html, "utf8");
      service.settleDesignTurn(
        input.chatId,
        input.conversationIncarnationId,
        input.turnId
      );
      await waitForDesignVersion(
        () => service.design.history.list(
          effective.stableWorkspaceOwnerId,
          file
        ).length > previousVersions
      );
      return {
        appId,
        dataCustodyId: data.dataCustodyId,
        file,
        stableWorkspaceOwnerId: effective.stableWorkspaceOwnerId,
        workspaceOwnerKind: effective.owner.kind,
        skillContent: await readFile(
          join(systemSkillsPath(), "design", "SKILL.md"),
          "utf8"
        ),
      };
    },
    suppressed(input) {
      return service.design.watcher.isSuppressed(input);
    },
    async clearExplicit(input) {
      const armed = await service.armDesignTurn({ ...input, explicitDesign: true });
      if (armed) {
        service.settleDesignTurn(
          input.chatId,
          input.conversationIncarnationId,
          input.turnId
        );
      }
      return armed;
    },
    async render(input) {
      const incarnationId = getIncarnationId(input.chatId);
      if (!incarnationId) throw new Error("Design E2E chat does not exist");
      const controller = new AbortController();
      const lease: BuiltinMcpLease = {
        leaseId: "design-e2e",
        chatId: input.chatId,
        incarnationId,
        requestId: "design-e2e",
        generation: 1,
        allowedTools: ["design_render_check"],
        initiatorBackend: "codex",
        resultByteBudget: 512 * 1024,
        socketToken: "design-e2e",
        signal: controller.signal,
        state: "ready",
      };
      const result = await registry.call("design_render_check", {
        file: input.file,
        viewport: input.viewport,
      }, {
        lease,
        invocationId: "design-e2e:render",
        signal: controller.signal,
      });
      return toBuiltinCallToolResult(result, lease.resultByteBudget, "design_render_check");
    },
  };
}

export function installBrowserE2eDriver(
  registry: BuiltinToolRegistry,
  getIncarnationId: (chatId: string) => string | undefined
) {
  if (process.env.AI_CHAT_BROWSER_E2E !== "1") return;
  const scope = globalThis as typeof globalThis & {
    __aiChatBrowserE2E?: BrowserE2eDriver;
  };
  const controller = new AbortController();
  scope.__aiChatBrowserE2E = {
    async call(chatId, tool, args) {
      const incarnationId = getIncarnationId(chatId);
      if (!incarnationId) throw new Error("Browser E2E chat 不存在");
      const lease: BuiltinMcpLease = {
        leaseId: "browser-e2e",
        chatId,
        incarnationId,
        requestId: "browser-e2e",
        generation: 1,
        allowedTools: BUILTIN_TOOL_SPECS.map((spec) => spec.name),
        initiatorBackend: "codex",
        resultByteBudget: 512 * 1024,
        socketToken: "browser-e2e",
        signal: controller.signal,
        state: "ready",
      };
      return registry.call(tool, args, {
        lease,
        invocationId: `browser-e2e:${tool}`,
        signal: controller.signal,
      });
    },
  };
}

async function waitForDesignVersion(probe: () => boolean) {
  const deadline = Date.now() + 8_000;
  while (!probe()) {
    if (Date.now() >= deadline) throw new Error("Design E2E version 等待超时");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
