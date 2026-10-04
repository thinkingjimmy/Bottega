/**
 * [INPUT]: Depends on the preload Extensions bridge and scope-aware shared DTOs
 * [OUTPUT]: Provides exact-scope list/install/lifecycle commands and native local-source selection plus revision-only invalidation subscription
 * [POS]: apps/desktop/src/lib/clients; Renderer Extension boundary; every mutation carries owner scope, Project incarnation and scope CAS
 */

import type {
  ExtensionPreflightView,
  ExtensionLocalPreflightInput,
  ExtensionScopeMutation,
  ExtensionScopeQuery,
  ExtensionsBridgeApi,
  ExtensionsChangedEvent,
  Sha256Digest,
} from "../../../shared/ipc/settings/extensions-ipc";
import type { ProductResourceScope } from "../../../shared/product/product-resource-scope";

declare global {
  interface Window {
    extensions?: ExtensionsBridgeApi;
  }
}

export const hasExtensionsBridge = () => Boolean(window.extensions);

function bridge() {
  if (!window.extensions) throw new Error("当前环境不支持扩展管理");
  return window.extensions;
}

export const listExtensions = (input: ExtensionScopeQuery) =>
  bridge().list(input);

export const preflightExtension = (input: {
  remoteRequestId?: string;
  surface?: "plugins";
  repoUrl: string;
  requestedRef?: string;
  subdirectory?: string;
  scope: ProductResourceScope;
  expectedProjectLifecycleRevision: number | null;
  expectedScopeRevision: number;
}): Promise<ExtensionPreflightView> => bridge().preflight(input);

export const localExtensionInstallAvailable = async (surface?: "plugins") => bridge().localInstallAvailable(surface);
export const preflightLocalExtension = (input: ExtensionLocalPreflightInput) => bridge().preflightLocal(input);

export const confirmExtension = (input: {
  surface?: "plugins";
  preflightId: string;
  expectedContentDigest: Sha256Digest;
  expectedResolvedCommit: string;
  migrateAppIds?: readonly string[];
}) => bridge().confirm(input);

export const discardExtensionPreflight = (preflightId: string) =>
  bridge().discard(preflightId);

export const beginDisableExtension = (input: ExtensionScopeMutation) =>
  bridge().beginDisable(input);

export const beginUninstallExtension = (input: ExtensionScopeMutation) =>
  bridge().beginUninstall(input);

export const resolveUninstallExtension = (
  input: ExtensionScopeMutation & { migrateAppIds?: readonly string[] }
) => bridge().resolveUninstall(input);

export const cancelUninstallExtension = (input: ExtensionScopeMutation) =>
  bridge().cancelUninstall(input);

export const purgeExtensionInstallData = (input: ExtensionScopeMutation) =>
  bridge().purgeInstallData(input);

export const onExtensionsChanged = (
  listener: (event: ExtensionsChangedEvent) => void
) => window.extensions?.onChanged(listener) ?? (() => {});
