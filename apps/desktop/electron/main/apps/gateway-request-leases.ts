/**
 * [INPUT]: Depends on the generation binding of the random id and route of the crypto; No import from the AppStore
 * [OUTPUT]: Provides GatewayRequestLeaseRegistry: acquire/release per request, generation-bound counting, intergenerational countApp and the embedblemer owner's admission
 * [POS]: Gateway fence for apps by request (D30); The long life of iframe/WS is therefore not viable across generation, and the drain is also accurate to count
 */

import { randomUUID } from "node:crypto";

export type GatewayGenerationBinding = Readonly<{
  generationId: string;
  lifecycleRevision: number;
}>;

type Held = GatewayGenerationBinding & { appId: string };

export class GatewayRequestLeaseRegistry {
  private readonly held = new Map<string, Held>();
  private readonly closed = new Map<string, number>();

  /* 关闭 admission 与等待 drain 是两件事：前者立刻拒新请求，后者由计数归零证明。
     只做前者会让删除误以为已经安全，只做后者永远等不到零。 */
  closeAdmission(appId: string) {
    this.closed.set(appId, (this.closed.get(appId) ?? 0) + 1);
  }

  reopenAdmission(appId: string) {
    const owners = this.closed.get(appId) ?? 0;
    if (owners <= 1) this.closed.delete(appId);
    else this.closed.set(appId, owners - 1);
  }

  isOpen(appId: string) {
    return !this.closed.has(appId);
  }

  /** 每次 HTTP 进入与每次 WS upgrade 各取一次；返回 null = 本请求不得放行。 */
  acquire(appId: string, binding: GatewayGenerationBinding) {
    if (this.closed.has(appId)) return null;
    const leaseId = randomUUID();
    this.held.set(leaseId, { appId, ...binding });
    return leaseId;
  }

  release(leaseId: string | null) {
    if (leaseId) this.held.delete(leaseId);
  }

  /** 跨代总数：cutover 要等的是「这个 App 再没有在途请求」，与哪一代无关。 */
  countApp(appId: string) {
    return [...this.held.values()].filter((item) => item.appId === appId).length;
  }

  /** 精确到 generation：旧代仍在服务时新代不能被当成「已经没人用」。 */
  count(appId: string, generationId: string) {
    const evidenceIds = [...this.held]
      .filter(
        ([, item]) => item.appId === appId && item.generationId === generationId
      )
      .map(([leaseId]) => leaseId);
    return {
      providerId: "gateway-request" as const,
      count: evidenceIds.length,
      evidenceIds,
    };
  }
}
