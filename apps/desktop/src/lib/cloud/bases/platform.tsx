/**
 * [INPUT]: Depends on the credential-free Base bridge, current account projection and shared Base platform.
 * [OUTPUT]: Adds scope-fenced synchronization review and source-device attachment names to the existing desktop Base views.
 * [POS]: Lazy Cloud-only renderer adapter; the Store and all candidate writes remain in main.
 */
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { BaseUIProvider, type BasePlatform } from "@ai-chat/base-ui/ui/platform/context";
import type { BaseSyncPresentation } from "@ai-chat/base-ui/sync/model";
import type { CloudBaseBridge } from "../../../../shared/cloud/base";
import { useCloudAccount } from "../client";
import { desktopBaseDeviceName } from "./device-name";
declare global { interface Window { cloudBase?: CloudBaseBridge } }
export function desktopBaseSync(bridge: CloudBaseBridge, expectedUserId: string, openCopy?: BaseSyncPresentation["openCopy"]): BaseSyncPresentation {
  return { scopeKey: expectedUserId,
    review: async (input, signal) => { signal.throwIfAborted(); const result = await bridge.review({ ...input, expectedUserId }); signal.throwIfAborted(); return result; },
    detail: async (input, signal) => { signal.throwIfAborted(); const result = await bridge.detail({ ...input, expectedUserId }); signal.throwIfAborted(); return result; },
    decide: input => bridge.decide({ ...input, expectedUserId }), subscribe: changed => bridge.onChanged(changed),
    copy: input => bridge.copy({ ...input, expectedUserId }), openCopy,
  };
}
export function CloudBasePlatform({ value, children }: { value: BasePlatform; children: ReactNode }) {
  const account = useCloudAccount(), userId = account.profile?.userId;
  const navigate = useNavigate();
  const allowed = Boolean(userId && ["ready", "temporarily-offline"].includes(account.status) && !["not-connected", "closing"].includes(account.sync.status));
  const sync = useMemo(() => allowed && userId && window.cloudBase ? desktopBaseSync(window.cloudBase, userId,
    identity => { if (identity.ownerKey.startsWith("project:")) void navigate(`/bases/project/${encodeURIComponent(identity.ownerKey.slice(8))}`); }) : undefined, [allowed, userId, navigate]);
  const sourceDeviceName = useMemo(() => allowed && userId && window.cloud ? desktopBaseDeviceName(window.cloud, userId) : undefined, [allowed, userId]);
  const platform = useMemo(() => ({ ...value, sync, attachments: { ...value.attachments, sourceDeviceName } }), [value, sync, sourceDeviceName]);
  return <BaseUIProvider value={platform}>{children}</BaseUIProvider>;
}
