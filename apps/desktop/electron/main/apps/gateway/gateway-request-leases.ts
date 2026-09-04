/**
 * [INPUT]: Depends on crypto request identities, Node HTTP/TCP transports, exact generation bindings, and bounded request evidence; it does not import AppStore
 * [OUTPUT]: Provides nested admission, idempotent request release, App/generation drain counts, bounded evidence for every held HTTP/WS authority, and explicit shutdown custody for accepted TCP connections
 * [POS]: App Gateway transport fence; static streams release in their pipeline finally, proxy/WS leases live until transport close, and SafeQuit actively releases accepted connections
 */

import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Socket } from "node:net";

export type GatewayGenerationBinding = Readonly<{
  generationId: string;
  lifecycleRevision: number;
}>;

type Held = GatewayGenerationBinding & { appId: string; requestEvidence: string };

export class GatewayConnectionCustody {
  private readonly connections = new Set<Socket>();

  track(connection: Socket) {
    this.connections.add(connection);
    connection.once("close", () => this.connections.delete(connection));
  }

  async close(server: Server) {
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
      /* 窗口仍活着时浏览器连接不会自然退出，网关不能把回收责任甩给窗口。 */
      for (const connection of this.connections) connection.destroy();
    });
    this.connections.clear();
  }
}

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
  acquire(appId: string, binding: GatewayGenerationBinding, requestEvidence = "internal") {
    if (this.closed.has(appId)) return null;
    const leaseId = randomUUID();
    this.held.set(leaseId, { appId, ...binding, requestEvidence: requestEvidence.slice(0, 512) });
    return leaseId;
  }

  release(leaseId: string | null) {
    if (leaseId) this.held.delete(leaseId);
  }

  /** 跨代总数：cutover 要等的是「这个 App 再没有在途请求」，与哪一代无关。 */
  countApp(appId: string) {
    return [...this.held.values()].filter((item) => item.appId === appId).length;
  }

  evidence(appId: string) {
    return [...this.held.entries()]
      .filter(([, item]) => item.appId === appId)
      .map(([leaseId, item]) => ({ leaseId, ...item }));
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
