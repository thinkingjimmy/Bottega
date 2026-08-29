/**
 * [INPUT]: Depends on rendererIpc, shared Memory channel, Provider Register Projection with Consent
 * [OUTPUT]: Provides registerMemoryServiceIpc with assertMemoryProviderId, centrally registers the status of the Memory façade, source observation, data directory reveal and Consent renderer pathways
 * [POS]: The IPC adapter for main/memory/service; Service provides the ability to close, no longer connect protocols to the lifecycle of the window
 */

import type { BrowserWindow } from "electron";
import { MEMORY_CHANNEL } from "../../../../shared/memory-ipc";
import type { MemoryAttentionAction } from "../../../../shared/memory-ipc";
import type {
  MemoryConsentReason,
} from "../../../../shared/memory-ipc";
import type { MemorySharingMode } from "../../../../shared/settings-ipc";
import { rendererIpc } from "../../ipc-registrar";
import {
  assertConsentAuthorityInput,
  assertConsentPreviewInput,
} from "../orchestration/consent-controller";
import {
  MEMORY_CONFIG_PANELS,
  MEMORY_PROVIDER_DESCRIPTORS,
} from "../providers/registry";

/* reveal 会把这个字符串变成真实数据目录路径并交给 Finder 打开：注册表形状之外
   一律在边界拒绝。禁止加 `m` 标志——多行模式下 `$` 认行尾，"everos\n" 会溜过去。 */
export function assertMemoryProviderId(raw: unknown) {
  if (typeof raw !== "string" || !/^[a-z0-9-]{1,64}$/.test(raw)) {
    throw new Error("Memory provider id 无效");
  }
  return raw;
}

export function registerMemoryServiceIpc(
  window: BrowserWindow,
  rendererUrl: string,
  dependencies: {
    status(): unknown;
    refresh(): Promise<unknown>;
    preview(
      providerId: string,
      includeHistory: boolean,
      reason: MemoryConsentReason,
      sharingMode: MemorySharingMode
    ): Promise<unknown>;
    request(
      providerId: string,
      includeHistory: boolean,
      reason: MemoryConsentReason,
      sharingMode: MemorySharingMode,
      previewDigest: string
    ): Promise<unknown>;
    resolveAttention(id: string, action: MemoryAttentionAction): Promise<unknown>;
    supply(): Promise<unknown>;
    reveal(providerId: string): void;
    closed(): void;
  }
) {
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 Memory 请求")
    .roles("main")
    .handle(MEMORY_CHANNEL.providers, () =>
      structuredClone(MEMORY_PROVIDER_DESCRIPTORS)
    )
    .handle(MEMORY_CHANNEL.configPanels, () =>
      structuredClone(MEMORY_CONFIG_PANELS)
    )
    .handle(MEMORY_CHANNEL.getStatus, () => dependencies.status())
    .handle(MEMORY_CHANNEL.refreshHealth, () => dependencies.refresh())
    .handle(MEMORY_CHANNEL.supplyStreams, () => dependencies.supply())
    .handle(MEMORY_CHANNEL.revealDataRoot, (raw) =>
      dependencies.reveal(assertMemoryProviderId(raw))
    )
    .handle(MEMORY_CHANNEL.resolveAttention, (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Memory attention 参数无效");
      }
      const input = raw as Record<string, unknown>;
      if (typeof input.id !== "string" || typeof input.action !== "string") {
        throw new Error("Memory attention 参数无效");
      }
      return dependencies.resolveAttention(
        input.id,
        input.action as MemoryAttentionAction
      );
    })
    .handle(MEMORY_CHANNEL.previewConsent, (raw) => {
      const input = assertConsentPreviewInput(raw);
      return dependencies.preview(
        input.providerId,
        input.includeHistory,
        input.reason,
        input.sharingMode
      );
    })
    .handle(MEMORY_CHANNEL.requestConsentAuthority, (raw) => {
      const input = assertConsentAuthorityInput(raw);
      return dependencies.request(
        input.providerId,
        input.includeHistory,
        input.reason,
        input.sharingMode,
        input.previewDigest
      );
    });
  window.once("closed", dependencies.closed);
}
