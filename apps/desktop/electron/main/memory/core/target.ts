/**
 * [INPUT]: Depends on shared Memory configuration/runtime contracts and the managed manifest version facts
 * [OUTPUT]: Provides candidate-first resolveMemoryTarget plus the canonical Memory fingerprint
 * [POS]: The Memory target authority; renderer, delivery, and runtime consume one fail-closed effective-version decision
 */

import type {
  MemoryEffectiveTarget,
  MemoryProviderDescriptor,
} from "../../../../shared/memory-ipc";
/* manifest 的形状由写它的人定义（zod schema 推导），这里只读。
   曾经在这里放过一份手抄影子，代价是它悄悄少了 versionChange。 */
import type { ManagedManifest } from "../runtime/managed/manifest";
import { normalizeMemoryBaseUrl } from "./provider";

export type TargetInput = {
  descriptor: MemoryProviderDescriptor;
  manifest: ManagedManifest | null;
  /** dataRoot marker token 与 manifest 是否一致；null = 尚未安装。 */
  ownershipValid: boolean | null;
  /* 判据是 configured 而不是 phase：phase 在写配置的那几秒是 running，
     拿它反推「配置齐没齐」，会在用户刚提交完密钥时答出「尚未配置」。 */
  runtime: { installed: boolean; configured: boolean } | null;
};

/* ============================================================
 * 解析只有一条路：manifest > descriptor 默认值。托管安装事实存在时
 * 永远用它；不存在时默认地址只用于解释尚未安装的目标。
 * ============================================================ */
export function resolveMemoryTarget(
  input: TargetInput
): MemoryEffectiveTarget {
  const { descriptor, manifest } = input;
  const source: MemoryEffectiveTarget["source"] = manifest ? "manifest" : "default";
  const baseUrl = normalizeMemoryBaseUrl(
    manifest?.baseUrl ?? descriptor.defaultBaseUrl
  );
  const managed = descriptor.managed && manifest !== null;
  const blockedReason = firstBlocker(input);
  return {
    providerId: descriptor.id,
    baseUrl,
    source,
    managed,
    instanceId: manifest?.instanceId ?? null,
    providerDataInstanceId: manifest
      ? `${manifest.providerId}:${manifest.instanceId}:${manifest.dataEpoch}`
      : null,
    expectedVersion:
      manifest?.versionChange?.targetVersion ?? manifest?.installedVersion ?? null,
    canConfigure: descriptor.configPanelId !== null && manifest !== null,
    canRebuild:
      blockedReason === null &&
      (descriptor.purgeModel === "workspace-purge" || manifest !== null),
    canEnable: blockedReason === null,
    blockedReasonCode:
      input.ownershipValid === false
        ? "ownership"
        : needsConfiguration(input)
          ? "configuration"
          : descriptor.managed && !manifest
            ? "not-installed"
            : null,
    blockedReason,
  };
}

/** 装好了却还缺必填配置——未安装不算，那是另一条更靠后的病因。 */
function needsConfiguration(input: TargetInput) {
  return Boolean(input.runtime?.installed && !input.runtime.configured);
}

function firstBlocker(input: TargetInput): string | null {
  const { descriptor, manifest } = input;
  if (input.ownershipValid === false) {
    return "托管数据目录的归属校验失败（可能被外部替换），已停用记忆以免写入陌生数据根。";
  }
  if (needsConfiguration(input)) {
    return `${descriptor.displayName} 尚未完成配置，提交密钥后才能启用。`;
  }
  if (descriptor.managed && !manifest) {
    return `${descriptor.displayName} 尚未安装；请先一键安装。`;
  }
  return null;
}

/* managed 指纹带上 instanceId：同一个地址换了一次全新安装，
   旧水位就不该被继承。受控 rebuild 不轮换 instanceId——它清的是
   数据，不是安装身份（D12）。 */
export function memoryFingerprint(target: MemoryEffectiveTarget) {
  return target.managed && target.providerDataInstanceId
    ? `${target.providerId}:${target.baseUrl}:${target.providerDataInstanceId}`
    : `${target.providerId}:${target.baseUrl}`;
}
