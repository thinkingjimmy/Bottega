/**
 * [INPUT]: Depends on AppDataCutoverLedger, Node fs with a narrow environment injected with the combination root ((closing access/removal route/drain/stop/custody count/active binding/appDir)
 * [OUTPUT]: Provides AppServerDataCutover and AppServerCutoverPort:§3.4 Fixed order epoch switching, isolation target reconcile and build and start
 * [POS]: The server data epoch of apps switches the editor; The AppStore only gets one data epochId that is CAS-enabled
 */

import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AppDataCutoverRecord,
  AppDataCutoverSource,
} from "../../../shared/app-lifecycle";
import { asError } from "../errors";
import type { AppDataCutoverLedger } from "./app-data-cutover-ledger";

/** AppStore 只认识这一个面：拿到 epoch id 去 CAS，成或败各回一次。 */
export type PreparedServerCutover = Readonly<{
  generationId: string;
  dataEpochId: string;
  commit(): Promise<void>;
  abort(): Promise<void>;
}>;

export type AppServerCutoverPort = {
  prepare(input: {
    appId: string;
    generationBuildId: string;
    generationId: string;
  }): Promise<PreparedServerCutover>;
};

/**
 * 组合根注入的窄环境。cutover 因此不 import AppStore/AppGateway/AppRuntime——
 * 它只知道「关准入」「撤 route」「等 drain」「停进程」这四个动词。
 */
export type AppServerCutoverEnvironment = {
  closeAdmission(appId: string): void | Promise<void>;
  reopenAdmission(appId: string): void | Promise<void>;
  revokeRoute(appId: string): void | Promise<void>;
  /** 等到该 App 的 HTTP/WS request lease 归零 */
  drainRequests(appId: string): Promise<void>;
  /** 停 runtime 并等到精确进程组退出 */
  stopRuntime(appId: string): Promise<void>;
  /** 仍未收敛的 ProcessCustody 条数；>0 即不得造新代 binary */
  unsettledCustody(appId: string): number;
  /** 当前 durable active server binding；重启对账凭它判断 CAS 是否已发生 */
  activeServerBinding(
    appId: string
  ): Readonly<{ generationId: string; dataEpochId: string }> | null;
  /** legacy 数据的来源目录（旧存量 App 的运行目录） */
  appDir(appId: string): string | null;
};

const LEGACY_DATA_DIR = "data";

export class AppServerDataCutover implements AppServerCutoverPort {
  private environment: AppServerCutoverEnvironment | null = null;

  constructor(
    private readonly userData: string,
    private readonly ledger: AppDataCutoverLedger
  ) {}

  configure(environment: AppServerCutoverEnvironment) {
    if (this.environment) throw new Error("server cutover environment 已配置");
    this.environment = environment;
  }

  /** 交付给 guardian 的可写根；activation-authorized 之前不得出现在任何 env 里。 */
  epochRoot(appId: string, dataEpochId: string) {
    return join(this.userData, "app-data", appId, dataEpochId);
  }

  /**
   * §3.4 固定顺序，全程在 lifecycle gate 之外：
   * open(durable) → 关准入 → 撤 route + drain + stop + 确认 custody 退出
   * → 构造并校验隔离 target epoch → prepared。CAS 留给调用方的短临界区。
   */
  async prepare(input: {
    appId: string;
    generationBuildId: string;
    generationId: string;
  }): Promise<PreparedServerCutover> {
    const environment = this.require();
    if (this.ledger.isRetiredBuild(input.generationBuildId)) {
      throw new Error("server data build 已永久退役");
    }
    const source = await this.resolveSource(input.appId);
    let cutover = await this.ledger.open({
      appId: input.appId,
      generationBuildId: input.generationBuildId,
      source,
      targetGenerationId: input.generationId,
    });
    if (cutover.disposition !== "open" && cutover.disposition !== "prepared") {
      throw new Error(
        `server data cutover ${cutover.generationBuildId} 已给出 ${cutover.disposition} 决定`
      );
    }
    /* 上一条命已经走到 prepared：那些 phase 标记只是进度，重放时不再推进，
       但等待与构造必须原样重来一遍——世界在崩溃期间是会动的。 */
    const resuming = cutover.disposition === "prepared";
    const mark = async (phase: AppDataCutoverRecord["phase"]) => {
      if (resuming) return;
      cutover = await this.ledger.advancePhase(
        cutover.generationBuildId,
        cutover.revision,
        phase
      );
    };
    try {
      await environment.closeAdmission(input.appId);
      await mark("source-drain");
      /* 三种 source 走同一条收敛：`none` 分支这三步天然是空操作，为它们写
         特例只会多出一条永远测不到的路径。 */
      await environment.revokeRoute(input.appId);
      await environment.drainRequests(input.appId);
      await environment.stopRuntime(input.appId);
      const unsettled = environment.unsettledCustody(input.appId);
      if (unsettled > 0) {
        throw new Error(
          `APP_SERVER_CUSTODY_UNSETTLED: 旧 custody 仍有 ${unsettled} 条未退出，拒绝构造新代 data epoch`
        );
      }
      await mark("target-build");
      await this.buildTargetEpoch(cutover);
      if (!resuming) {
        cutover = await this.ledger.prepare(
          cutover.generationBuildId,
          cutover.revision
        );
      }
    } catch (cause) {
      await this.rollback(cutover).catch((nested) =>
        console.warn("[apps] cutover 回退失败", asError(nested).message)
      );
      throw cause;
    }
    return this.handle(cutover);
  }

  /**
   * 启动对账：唯一判据是 durable active binding 是否已指向 target。
   * 「CAS 到底发生没发生」只有 AppStore 那条记录说了算，物理目录不作数——
   * 只看到 target 目录而没有 committed 记录不能开放 runtime。
   *
   * 三个结局互斥：target 仍是 live 就补完 committed；已被后一代取代的
   * committed fence 退役；其余一律回退到未被触碰的 source。
   */
  async reconcile() {
    const environment = this.require();
    const settled = {
      committed: [] as string[],
      released: [] as string[],
      rolledBack: [] as string[],
    };
    for (const cutover of this.ledger.listUnsettled()) {
      const active = environment.activeServerBinding(cutover.appId);
      const live =
        active?.generationId === cutover.target.generationId &&
        active?.dataEpochId === cutover.target.dataEpochId;
      if (live) {
        if (cutover.disposition !== "committed") {
          await this.finishCommit(cutover);
          settled.committed.push(cutover.generationBuildId);
        }
      } else if (cutover.disposition === "committed") {
        /* target 已被另一代替换：fence 可以退役，retained epoch 仍留作审计。 */
        await this.ledger.release(cutover.generationBuildId, cutover.revision);
        settled.released.push(cutover.generationBuildId);
      } else {
        await this.rollback(cutover);
        settled.rolledBack.push(cutover.generationBuildId);
      }
      await environment.reopenAdmission(cutover.appId);
    }
    return settled;
  }

  private handle(prepared: AppDataCutoverRecord): PreparedServerCutover {
    let current = prepared;
    return {
      generationId: current.target.generationId,
      dataEpochId: current.target.dataEpochId,
      commit: async () => {
        current = await this.ledger.commit(
          current.generationBuildId,
          current.revision
        );
        await this.require().reopenAdmission(current.appId);
      },
      abort: async () => {
        await this.rollback(current);
        await this.require().reopenAdmission(current.appId);
      },
    };
  }

  /** 从 prepared/committed 之外的任一格补齐到 committed；epoch 所有权在同一笔 decision 里翻转。 */
  private async finishCommit(input: AppDataCutoverRecord) {
    let cutover = input;
    if (cutover.disposition === "abort-pending") {
      throw new Error(
        `APP_SERVER_CUTOVER_CONTRADICTION: ${cutover.generationBuildId} 已决定 abort，但 active binding 指向 target`
      );
    }
    if (cutover.disposition === "open") {
      cutover = await this.ledger.prepare(
        cutover.generationBuildId,
        cutover.revision
      );
    }
    if (cutover.disposition === "prepared") {
      cutover = await this.ledger.commit(
        cutover.generationBuildId,
        cutover.revision
      );
    }
    return cutover;
  }

  /** 切换前失败：target 目录清掉，source epoch 一个字节都没动过，原样重新开放。 */
  private async rollback(input: AppDataCutoverRecord) {
    let cutover = this.ledger.get(input.generationBuildId) ?? input;
    if (
      cutover.disposition === "aborted" ||
      cutover.disposition === "released" ||
      cutover.disposition === "committed"
    ) {
      return cutover;
    }
    if (cutover.disposition !== "abort-pending") {
      cutover = await this.ledger.beginAbort(
        cutover.generationBuildId,
        cutover.revision
      );
    }
    const target = this.epochRoot(cutover.appId, cutover.target.dataEpochId);
    await rm(target, { recursive: true, force: true });
    await rm(`${target}.staging`, { recursive: true, force: true });
    return this.ledger.abort(cutover.generationBuildId, cutover.revision);
  }

  /**
   * source 判定只信两样：durable active binding 与 ledger 里那条 epoch 记录。
   * 任一分支都不伪造 source generation——没有 active epoch 就绝不写 `existing`。
   */
  private async resolveSource(appId: string): Promise<AppDataCutoverSource> {
    const environment = this.require();
    const active = environment.activeServerBinding(appId);
    if (active) {
      const epoch = this.ledger.epoch(active.dataEpochId);
      if (epoch?.state === "active") {
        return {
          kind: "existing",
          generationId: active.generationId,
          dataEpochId: active.dataEpochId,
        };
      }
    }
    const appDir = environment.appDir(appId);
    const legacy = appDir ? join(appDir, LEGACY_DATA_DIR) : null;
    if (legacy && (await isDirectory(legacy))) {
      return { kind: "legacy-import", snapshotId: randomUUID() };
    }
    return { kind: "none" };
  }

  /**
   * 隔离构造：先在 `<epoch>.staging` 里建好再 rename。target epoch 因此要么
   * 完整存在要么根本不存在，不会出现「目录在但内容是半份」的可见中间态。
   */
  private async buildTargetEpoch(cutover: AppDataCutoverRecord) {
    const target = this.epochRoot(cutover.appId, cutover.target.dataEpochId);
    if (await isDirectory(target)) return;
    const staging = `${target}.staging`;
    await mkdir(join(this.userData, "app-data", cutover.appId), {
      recursive: true,
    });
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const origin = await this.materializeSource(cutover);
    if (origin) {
      await cp(origin, staging, { recursive: true, force: true });
      await assertTreeCopied(origin, staging);
    }
    await rename(staging, target);
  }

  /**
   * legacy 只读一次：第一次把 `<appDir>/data` fsync 成不可变 snapshot，
   * 之后每次重放都只读那份 snapshot——中断可重放正是靠这条不变式，
   * 否则第二次会把「已经被新代改过的 legacy 目录」当成原始数据。
   */
  private async materializeSource(cutover: AppDataCutoverRecord) {
    if (cutover.source.kind === "none") return null;
    if (cutover.source.kind === "existing") {
      return this.epochRoot(cutover.appId, cutover.source.dataEpochId);
    }
    const snapshot = join(
      this.userData,
      "app-data",
      cutover.appId,
      "legacy",
      cutover.source.snapshotId
    );
    if (await isDirectory(snapshot)) return snapshot;
    const appDir = this.require().appDir(cutover.appId);
    if (!appDir) throw new Error("legacy import 找不到 App 运行目录");
    const legacy = join(appDir, LEGACY_DATA_DIR);
    const staging = `${snapshot}.staging`;
    await mkdir(join(this.userData, "app-data", cutover.appId, "legacy"), {
      recursive: true,
    });
    await rm(staging, { recursive: true, force: true });
    await cp(legacy, staging, { recursive: true, force: true });
    await assertTreeCopied(legacy, staging);
    await rename(staging, snapshot);
    return snapshot;
  }

  /** delete 的物理收尾；ledger 状态由调用方推进，这里只负责字节。 */
  removeEpochRoot(appId: string, dataEpochId: string) {
    return rm(this.epochRoot(appId, dataEpochId), {
      recursive: true,
      force: true,
    });
  }

  /**
   * retain-data 的字节转移：原子 rename 到独立 archive aggregate 根。
   * 必须真的搬字节——只写一条 `archived` 记录、随后照常删原写根，等于把
   * 用户明确要求保留的数据删掉。搬完原写根自然不存在，删除步骤是空操作。
   */
  async handOffEpochRoot(appId: string, dataEpochId: string, destination: string) {
    const source = this.epochRoot(appId, dataEpochId);
    if (!(await isDirectory(source))) return false;
    await mkdir(dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(source, destination);
    return true;
  }

  removeAppData(appId: string) {
    return rm(join(this.userData, "app-data", appId), {
      recursive: true,
      force: true,
    });
  }

  private require() {
    if (!this.environment) {
      throw new Error("server cutover environment 尚未配置");
    }
    return this.environment;
  }
}

async function isDirectory(path: string) {
  return stat(path)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
}

/** 复制校验：逐条相对路径比对，缺一条就不是「隔离构造完成」。 */
async function assertTreeCopied(source: string, target: string) {
  const [left, right] = await Promise.all([
    listTree(source),
    listTree(target),
  ]);
  const missing = left.filter((path) => !right.includes(path));
  if (missing.length) {
    throw new Error(
      `server data epoch 复制不完整，缺少 ${missing.slice(0, 5).join("、")}`
    );
  }
}

async function listTree(root: string): Promise<string[]> {
  const entries = await readdir(root, {
    withFileTypes: true,
    recursive: true,
  }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(root, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join("/")
    )
    .sort();
}
