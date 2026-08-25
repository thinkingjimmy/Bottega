/**
 * [INPUT]: Depends on MemoryProvider, MemoryNetwork Runtime, ControlState, and provider adapter
 * [OUTPUT]: Provides a generation-specific health monitor, a single-sample RuntimeReadinessProof waiting machine, a general RuntimeHealth projection and a default probe that only determines reach
 * [POS]: The boundary between availability and readiness proof of the provider of the main/memory/runtime/control; Private wire stays in adapter, old configuration/old routing samples never cover new facts
 */

import type {
  MemoryHealthIssue,
  MemoryStatusSnapshot,
} from "../../../../../shared/memory-ipc";
import type { MemoryNetworkRuntime } from "../network-runtime";
import type { MemoryProvider } from "../../core/provider";

const HEALTH_TTL_MS = 30_000;

type HealthControl = {
  generation: number;
  effectiveFingerprint: string;
};

type RefreshInput = {
  force: boolean;
  control: HealthControl;
  provider: MemoryProvider;
  network: MemoryNetworkRuntime;
  current(): HealthControl;
  publish(): void;
  status(): MemoryStatusSnapshot;
  /** 托管后端：health 通过后再验监听者确属自有实例；不符即 fail-closed。
      纯自建/未托管场景不传，行为不变。 */
  verifyIdentity?: () => Promise<boolean>;
};

export class MemoryHealthMonitor {
  value: MemoryStatusSnapshot["health"] = "unknown";
  issue: MemoryHealthIssue | null = null;
  version: string | null = null;
  private checkedAt = 0;
  private checkedKey: string | null = null;
  private flight: {
    key: string;
    task: Promise<MemoryStatusSnapshot>;
  } | null = null;

  reset() {
    this.value = "unknown";
    this.issue = null;
    this.version = null;
    this.checkedAt = 0;
    this.checkedKey = null;
  }

  refresh(input: RefreshInput) {
    const { generation, effectiveFingerprint } = input.control;
    const key = `${generation}:${effectiveFingerprint}`;
    if (
      !input.force &&
      Date.now() - this.checkedAt < HEALTH_TTL_MS &&
      this.value !== "unknown" &&
      this.checkedKey === key
    ) {
      return Promise.resolve(input.status());
    }
    if (this.flight?.key === key) return this.flight.task;
    /* checking 只属于首次探测：后台按 TTL 复检时保持上一结论，
       否则 unavailable 卡片每 30s 闪一次「检查中」。 */
    if (this.value === "unknown") {
      this.value = "checking";
      input.publish();
    }
    const task = this.check(input, generation, effectiveFingerprint).finally(
      () => {
        if (this.flight?.task === task) this.flight = null;
      }
    );
    this.flight = { key, task };
    return input.network.track(task);
  }

  private async check(
    input: RefreshInput,
    generation: number,
    fingerprint: string
  ) {
    const controller = input.network.controller();
    try {
      const probe = await input.provider.health({
        signal: controller.signal,
      });
      /* 探针可达不代表可信：托管后端还要证明端口监听者是自己那个实例。
         校验子进程只在 health 实际探测时（非缓存命中）跑一次，成本随 TTL 摊薄。 */
      const identityOk =
        probe.status === "unavailable" || !input.verifyIdentity
          ? true
          : await input.verifyIdentity().catch(() => false);
      if (this.canPublish(input, controller, generation, fingerprint)) {
        this.version = probe.version ?? null;
        if (!identityOk) {
          this.value = "unavailable";
          this.issue = {
            kind: "identity",
            detail: "端口监听者不是托管实例",
          };
        } else {
          this.value = probe.status;
          this.issue = probe.status === "ready" ? null : probe.issue;
        }
        this.checkedAt = Date.now();
        this.checkedKey = `${generation}:${fingerprint}`;
      }
    } catch {
      if (this.canPublish(input, controller, generation, fingerprint)) {
        this.value = "unavailable";
        this.issue = { kind: "unreachable", detail: "服务暂时不可达" };
        this.version = null;
        this.checkedAt = Date.now();
        this.checkedKey = `${generation}:${fingerprint}`;
      }
    } finally {
      input.network.release(controller);
    }
    input.publish();
    return input.status();
  }

  private canPublish(
    input: RefreshInput,
    controller: AbortController,
    generation: number,
    fingerprint: string
  ) {
    const current = input.current();
    return (
      !controller.signal.aborted &&
      !input.network.isStopping &&
      current.generation === generation &&
      current.effectiveFingerprint === fingerprint
    );
  }
}

export type RuntimeHealth = Readonly<{
  healthy: boolean;
  version: string | null;
  ready: boolean;
}>;

export type RuntimeReadinessProof = Readonly<{
  version: string | null;
  ready: boolean;
}>;

export async function waitForRuntimeReadiness(input: {
  read(): Promise<RuntimeHealth>;
  expectedVersion: string | null;
  timeoutMs: number;
  pollMs?: number;
  displayName: string;
}): Promise<RuntimeReadinessProof> {
  const deadline = Date.now() + input.timeoutMs;
  let current: RuntimeHealth | null = null;
  do {
    current = await input.read();
    assertRuntimeVersionMatch(current, input.expectedVersion);
    if (current.healthy && current.ready) {
      assertRuntimeVersionProof(current, input.expectedVersion);
      return { version: current.version, ready: true };
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(input.pollMs ?? 2_000, remaining))
      );
    }
  } while (Date.now() < deadline);

  if (current?.healthy) {
    assertRuntimeVersionProof(current, input.expectedVersion);
    return { version: current.version, ready: false };
  }
  throw new Error(`${input.displayName} 健康检查超时`);
}

function assertRuntimeVersionMatch(
  health: RuntimeHealth,
  expectedVersion: string | null
) {
  if (health.version !== null && expectedVersion !== null &&
      health.version !== expectedVersion) {
    throw new Error(
      `运行版本断言失败：期望 ${expectedVersion}，实得 ${health.version}`
    );
  }
}

function assertRuntimeVersionProof(
  health: RuntimeHealth,
  expectedVersion: string | null
) {
  assertRuntimeVersionMatch(health, expectedVersion);
  if (expectedVersion !== null && health.version === null) {
    throw new Error("运行版本身份未证明：当前健康响应缺少实测版本");
  }
}

export async function readProviderRuntimeHealth(
  provider: MemoryProvider
): Promise<RuntimeHealth> {
  const probe = await provider.health();
  return {
    healthy: probe.runtimeHealthy ?? probe.status !== "unavailable",
    ready: probe.runtimeReady ?? (
      probe.status === "ready" || probe.status === "compat"
    ),
    version: probe.version ?? null,
  };
}

export async function defaultRuntimeProbe(baseUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}/health`, {
      redirect: "error",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
