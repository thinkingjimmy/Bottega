/**
 * [INPUT]: Depends on node: crypto, AppStore and shared apps DTO
 * [OUTPUT]: Provides AppManagementLease and AppManagementLeaseRegistry: to issue an active generation/digest of app management sessions that bind webContents/renderer sessions and to stabilize the machine code and review it step by step
 * [POS]: The main-only session registry of apps/attachments; It responds by saying "Does this App's details page represent the same generation of apps right now?" and has nothing to do with the attachment surface's conversation scope
 */

import { randomUUID } from "node:crypto";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";
import type { AppDomainIdentity } from "../../../../shared/apps-ipc";
import type { AppStore } from "../app-store";

/**
 * 管理会话只描述「哪一代 App」与「谁在看」。它**不**携带任何 conversation /
 * grant 信息——App 详情页的权限根是 App 自己的 lifecycle，而不是某条聊天的授权。
 */
export type AppManagementLease = Readonly<{
  managementLeaseId: string;
  appId: string;
  generationId: string;
  contentDigest: Sha256Digest;
  lifecycleRevision: number;
  domainIdentity: AppDomainIdentity;
  /** 绑定的 renderer 身份；跨窗口或导航之后一律失效 */
  webContentsId: number;
  rendererSessionId: string;
}>;

export class AppManagementLeaseRegistry {
  private readonly leases = new Map<string, AppManagementLease>();

  constructor(
    private readonly apps: Pick<AppStore, "get">,
    private readonly createId: () => string = randomUUID
  ) {}

  /**
   * 只对 ready、有 active generation 的 App 签发。`domainIdentity` 一并冻结：
   * 领域适配层据此判断「这一代还是不是那个领域」，而不是再去读一次 Store——
   * 两处各读一次，迟早只有一处跟上 promote。
   */
  issue(input: {
    appId: string;
    webContentsId: number;
    rendererSessionId: string;
  }): AppManagementLease {
    const lease: AppManagementLease = {
      managementLeaseId: this.createId(),
      ...this.liveFacts(input.appId),
      webContentsId: input.webContentsId,
      rendererSessionId: input.rendererSessionId,
    };
    this.leases.set(lease.managementLeaseId, lease);
    return lease;
  }

  /** generation promote / lifecycle bump / 删除任一发生，管理 lease 当场失效。 */
  describe(managementLeaseId: string): AppManagementLease {
    const lease = this.leases.get(managementLeaseId);
    if (!lease) {
      throw statusError(
        "APP_MANAGEMENT_LEASE_INVALID",
        403,
        "App 管理会话无效"
      );
    }
    const live = this.liveFacts(lease.appId);
    if (
      live.generationId !== lease.generationId ||
      live.contentDigest !== lease.contentDigest ||
      live.lifecycleRevision !== lease.lifecycleRevision
    ) {
      this.leases.delete(managementLeaseId);
      throw statusError(
        "APP_MANAGEMENT_LEASE_STALE",
        409,
        "App 管理会话已因 generation/lifecycle 变化失效"
      );
    }
    return lease;
  }

  release(managementLeaseId: string) {
    this.leases.delete(managementLeaseId);
  }

  /** 删除/换代时统一撤销；与 surface lease 挂在同一批调用点。 */
  revokeApp(appId: string) {
    for (const [leaseId, lease] of this.leases) {
      if (lease.appId === appId) this.leases.delete(leaseId);
    }
  }

  /** 导航、reload 与窗口销毁：旧 renderer 身份下的会话一律作废。 */
  revokeRenderer(input: { webContentsId: number; rendererSessionId?: string }) {
    for (const [leaseId, lease] of this.leases) {
      if (
        lease.webContentsId === input.webContentsId &&
        (input.rendererSessionId === undefined ||
          lease.rendererSessionId !== input.rendererSessionId)
      ) {
        this.leases.delete(leaseId);
      }
    }
  }

  private liveFacts(appId: string) {
    const record = this.apps.get(appId);
    const active = record?.generationBinding.active;
    const generation = record?.generations.find(
      (item) => item.generationId === active?.generationId
    );
    if (!record || record.state !== "ready" || !generation || !record.domainIdentity) {
      /* 404 而不是 403：区分「不存在」与「无权」会泄露其它 App 的存在性。 */
      throw statusError(
        "APP_MANAGEMENT_APP_UNAVAILABLE",
        404,
        "该 App 当前不可签发管理会话"
      );
    }
    return {
      appId: record.id,
      generationId: generation.generationId,
      contentDigest: generation.contentDigest,
      lifecycleRevision: record.lifecycleRevision,
      domainIdentity: structuredClone(record.domainIdentity),
    };
  }
}

function statusError(code: string, status: number, message: string) {
  return Object.assign(new Error(message), { code, status });
}
