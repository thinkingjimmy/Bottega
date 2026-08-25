/**
 * [INPUT]: Depends on AsyncLocalStorage and Memory Promise
 * [OUTPUT]: Provides a global authorization strategy/Project/App/Attachment four-tiered admission gate, attachment key, single point `attachmentAdmissionKey`AppUsageRegistry with five sets of AppPlatformAdmission, fixed D26 sequences and reverse to fail-fast
 * [POS]: App Attach and launch the lifecycle baseline; Composition root is not dependent on any Store, but only builds an AppPlatformAdmission
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type GateScope = { highestRank: number; keys: Set<string> };
const scope = new AsyncLocalStorage<GateScope>();

class OrderedAdmissionGate {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly closed = new Map<string, number>();

  constructor(
    private readonly rank: number,
    private readonly label: string
  ) {}

  revision(key: string) {
    return this.closed.get(key) ?? 0;
  }

  isOpen(key: string) {
    return !this.closed.has(key);
  }

  close(key: string) {
    const revision = this.revision(key) + 1;
    this.closed.set(key, revision);
    return revision;
  }

  reopen(key: string, expectedRevision: number) {
    if (this.revision(key) !== expectedRevision) throw new Error("ADMISSION_REVISION_MISMATCH");
    this.closed.delete(key);
  }

  run<T>(key: string, operation: () => Promise<T> | T) {
    const current = scope.getStore();
    if (current && this.rank < current.highestRank) {
      throw new Error(`LOCK_ORDER_VIOLATION:${this.label}:${key}`);
    }
    if (current?.keys.has(`${this.rank}:${key}`)) return Promise.resolve(operation());
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => tail);
    this.tails.set(key, chained);
    return previous.then(() => {
      const next: GateScope = {
        highestRank: Math.max(current?.highestRank ?? -1, this.rank),
        keys: new Set([...(current?.keys ?? []), `${this.rank}:${key}`]),
      };
      return scope.run(next, async () => {
        try {
          return await operation();
        } finally {
          release();
          if (this.tails.get(key) === chained) this.tails.delete(key);
        }
      });
    });
  }
}

export class ProjectLifecycleAdmissionGate extends OrderedAdmissionGate {
  constructor() {
    super(10, "project");
  }
}

/** 默认全局授权会影响每一个 Project；它必须排在具体 Project 之前。 */
export class AppGrantPolicyAdmissionGate extends OrderedAdmissionGate {
  constructor() {
    super(5, "app-grant-policy");
  }
}

export class AppLifecycleAdmissionGate extends OrderedAdmissionGate {
  constructor() {
    super(20, "app");
  }
}

export class AttachmentAdmissionGate extends OrderedAdmissionGate {
  constructor() {
    super(40, "attachment");
  }
}

/**
 * D26 的固定全序只有打包成一组单例才成立：两处各 `new` 一个 gate，锁序图上就是
 * 两条互不相识的边，写得再对也拦不住 ABA。composition root 只构造这一个对象。
 */
export class AppPlatformAdmission {
  readonly grantPolicy = new AppGrantPolicyAdmissionGate();
  readonly project = new ProjectLifecycleAdmissionGate();
  readonly app = new AppLifecycleAdmissionGate();
  readonly usage = new AppUsageRegistry();
  readonly attachment = new AttachmentAdmissionGate();
}

/**
 * attachment gate 的 key 空间归 gate 自己。grant 与 conversion
 * 若各写一份 key 格式，两条路径就会排在两把互不相识的队里——锁序图上看着有边，
 * 运行时谁也拦不住谁。
 */
export const attachmentAdmissionKey = (
  target: { kind: "chat"; chatId: string } | { kind: "project"; projectId: string }
) => (target.kind === "chat" ? `chat:${target.chatId}` : `project:${target.projectId}`);

export type AppUsagePlanningLease = Readonly<{
  usageLeaseId: string;
  appId: string;
  generationId: string;
  lifecycleRevision: number;
}>;

export class AppUsageRegistry {
  private readonly leases = new Map<string, AppUsagePlanningLease>();
  private readonly closedApps = new Set<string>();

  closeAdmission(appId: string) {
    this.closedApps.add(appId);
  }

  acquire(input: Omit<AppUsagePlanningLease, "usageLeaseId">) {
    if (this.closedApps.has(input.appId)) throw new Error("APP_USAGE_ADMISSION_CLOSED");
    const lease = { ...input, usageLeaseId: randomUUID() };
    this.leases.set(lease.usageLeaseId, lease);
    return structuredClone(lease);
  }

  release(usageLeaseId: string) {
    this.leases.delete(usageLeaseId);
  }

  count(appId: string, generationId?: string) {
    return [...this.leases.values()].filter(
      (lease) =>
        lease.appId === appId &&
        (!generationId || lease.generationId === generationId)
    ).length;
  }
}
