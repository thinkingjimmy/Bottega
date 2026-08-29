/**
 * [INPUT]: Depends on the App/Base/Project store, base sample, synthesizer, package-contract, templates, README positioning, fixed git/gh subprocesses (runner can be injected) and lifecycle gate
 * [OUTPUT]: Provides ShareFlow preview/publish/discard/recover with ShareCommandRunner; The data is presented in three ways: history continuous re-share; commitSha push; publishedRepoUrl replenish;
 * [POS]: The GitHub external side effects saga of apps/share; Agent is completely uninvolved, staging is pending while recovering evidence cannot be removed, and the crash is resumed by share-publish intent
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AppRecord,
  SharePreview,
  SharePreviewInput,
  SharePublishInput,
} from "../../../../shared/apps-ipc";
import { sampleSnapshot } from "../../../../shared/base-sample-synth";
import {
  baseSnapshotFile,
  baseSnapshotFileSchema,
} from "../../../../shared/base-snapshot";
import type { BaseStore } from "../../bases/base-store";
import type { LifecycleIntent } from "../../lifecycle/intent-types";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import type { AdmissionGate, SagaResult } from "../../lifecycle/admission-gate";
import type { ProjectStore } from "../../projects/project-store";
import { sanitizedProcessEnvironment } from "../../codex-runtime";
import type { AppStore } from "../app-store";
import { README_SKELETON_HINT } from "../templates";
import {
  copyPackage,
  inspectPackage,
  packageDigest,
} from "./package-contract";

type StoredPreview = {
  appId: string;
  dataMode: SharePreviewInput["dataMode"];
  digest: string;
  staging: string;
  repoName: string;
  targetOwner: string;
  visibility: "public" | "private";
  existingRemote: boolean;
  expectedRemoteHead: string | null;
  rowCount: number;
};

/** 固定子进程执行器；测试注入假 runner 以锁定 git/gh 参数序列。 */
export type ShareCommandRunner = (
  executable: string,
  args: string[],
  cwd: string
) => Promise<string>;

export class ShareFlow {
  private readonly root: string;
  private readonly previews = new Map<string, StoredPreview>();

  constructor(
    userData: string,
    private readonly apps: AppStore,
    private readonly projects: ProjectStore,
    private readonly bases: BaseStore,
    private readonly intents: LifecycleIntentStore,
    private readonly gate: AdmissionGate,
    private readonly run: ShareCommandRunner = command
  ) {
    this.root = join(userData, "app-share");
  }

  async preview(input: SharePreviewInput): Promise<SharePreview> {
    const record = requireShareable(this.apps.get(input.appId));
    const project = this.projects.findByAppId(record.id);
    if (!project) throw new Error("Base App 缺少 Project");
    const source = this.bases.get(`project:${project.id}`);
    if (!source) throw new Error("Base App 缺少 Base 数据");
    const portable = baseSnapshotFile(source);
    const snapshot =
      input.dataMode === "full"
        ? portable
        : input.dataMode === "sample"
          ? sampleSnapshot(
              {
                schemaVersion: 2,
                name: portable.name,
                columns: portable.columns,
                views: portable.views,
              },
              // 只递真实 row id 供避让，行内容仍零依赖——导入过示例包的
              // Base 里 sample_1..3 是合法真实行，不避让即永久闸死示例 re-share
              new Set(portable.rows.map((row) => row.id))
            )
          : baseSnapshotFileSchema.parse({ ...portable, rows: [] });
    if (input.dataMode !== "full") {
      assertDisjointSampleRows(
        portable.rows.map((row) => row.id),
        snapshot.rows.map((row) => row.id)
      );
    }

    const previewId = randomUUID();
    const staging = join(this.root, previewId);
    const worktree = join(staging, "worktree");
    try {
      await mkdir(worktree, { recursive: true, mode: 0o700 });
      if (record.publishedRepoUrl) {
        await this.run(
          "git",
          ["clone", "--depth", "1", record.publishedRepoUrl, "."],
          worktree
        );
        await clearWorktree(worktree);
      } else {
        await this.run("git", ["init"], worktree);
      }
      const copied = await copyPackage(record.dir, worktree);
      const dataPath = join(worktree, "data", "base.json");
      await mkdir(dirname(dataPath), { recursive: true, mode: 0o700 });
      await chmod(dataPath, 0o600).catch(() => undefined);
      await writeFile(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        mode: 0o400,
      });
      await chmod(dataPath, 0o400);
      const inspection = await inspectPackage(worktree);
      const digest = await packageDigest(worktree, inspection.files);
      const status = record.publishedRepoUrl
        ? await this.run("git", ["status", "--short"], worktree)
        : "";
      const readme = await readFile(join(worktree, "README.md"), "utf8").catch(
        () => ""
      );
      const publishedTarget = record.publishedRepoUrl
        ? parsePublishedTarget(record.publishedRepoUrl)
        : null;
      const targetOwner =
        publishedTarget?.owner ??
        assertGithubLogin(
          (await this.run("gh", ["api", "user", "--jq", ".login"], worktree)).trim()
        );
      const repoName = publishedTarget?.repo ?? assertRepoName(input.repoName);
      const expectedRemoteHead = record.publishedRepoUrl
        ? (await this.run("git", ["rev-parse", "HEAD"], worktree)).trim()
        : null;
      this.previews.set(previewId, {
        appId: record.id,
        dataMode: input.dataMode,
        digest,
        staging,
        repoName,
        targetOwner,
        visibility: input.visibility,
        existingRemote: Boolean(record.publishedRepoUrl),
        expectedRemoteHead,
        rowCount: snapshot.rows.length,
      });
      return {
        previewId,
        digest,
        files: inspection.files,
        rowCount: snapshot.rows.length,
        sampleRows: snapshot.rows.slice(0, 3),
        ignored: copied.ignored,
        readmePlaceholder:
          readme.includes(README_SKELETON_HINT) || !readme.trim(),
        diffSummary: record.publishedRepoUrl
          ? status.trim() || "与上次发布一致"
          : "首次发布，将创建新仓库",
      };
    } catch (cause) {
      await rm(staging, { recursive: true, force: true });
      throw cause;
    }
  }

  async publishShare(input: SharePublishInput) {
    const preview = this.previews.get(input.previewId);
    if (
      !preview ||
      preview.appId !== input.appId ||
      preview.digest !== input.confirmedDigest
    ) {
      throw new Error("分享预览已失效，请重新预览");
    }
    const outcome = await this.gate.admitAndRun<AppRecord>(
      {
        kind: "share-publish",
        requestId: input.requestId,
        input: {
          appId: input.appId,
          mode: preview.dataMode,
          confirmedDigest: input.confirmedDigest,
          targetOwner: preview.targetOwner,
          targetName: preview.repoName,
          visibility: preview.visibility,
          targetType: preview.existingRemote ? "existing" : "create",
          expectedRemoteHead: preview.expectedRemoteHead,
          staging: preview.staging,
          rowCount: preview.rowCount,
        },
      },
      (intent) => this.execute(intent, preview)
    );
    if (outcome.state === "executed") {
      if (outcome.result.status === "done" && outcome.result.value) {
        this.previews.delete(input.previewId);
        return outcome.result.value;
      }
      if (outcome.result.status === "business-rejected") {
        throw new Error(outcome.result.error.message);
      }
      throw new Error("分享未完成");
    }
    if (outcome.status === "done") {
      const current = this.apps.get(input.appId);
      if (current) return current;
    }
    throw new Error(outcome.error?.message ?? "分享被并发请求拒绝");
  }

  async discardPreview(previewId: string) {
    const preview = this.previews.get(previewId);
    this.previews.delete(previewId);
    if (!preview) return;
    const pending = await this.intents.pendingByClaims([
      `app:${preview.appId}`,
    ]);
    /* 发布已入 journal 且未终结：staging 是恢复续推的唯一物证，只弃预览不删盘。
     * 物证判定按「就是这份 staging」——同 app 另一笔 pending 发布引用的是它自己的
     * staging，不能连坐保下这一份。 */
    if (
      pending.some(
        (intent) =>
          intent.kind === "share-publish" &&
          intent.input.staging === preview.staging
      )
    ) {
      return;
    }
    await rm(preview.staging, { recursive: true, force: true });
  }

  recover(intent: LifecycleIntent) {
    return this.execute(intent, {
      appId: String(intent.input.appId),
      dataMode:
        intent.input.mode === "full" ||
        intent.input.mode === "sample" ||
        intent.input.mode === "schema"
          ? intent.input.mode
          : "schema",
      digest: String(intent.input.confirmedDigest),
      staging: String(intent.input.staging),
      repoName: String(intent.input.targetName),
      targetOwner: String(intent.input.targetOwner),
      visibility: intent.input.visibility === "private" ? "private" : "public",
      existingRemote: intent.input.targetType === "existing",
      expectedRemoteHead:
        typeof intent.input.expectedRemoteHead === "string"
          ? intent.input.expectedRemoteHead
          : null,
      rowCount: Number(intent.input.rowCount ?? 0),
    });
  }

  private async execute(
    intent: LifecycleIntent,
    preview: StoredPreview
  ): Promise<SagaResult<AppRecord>> {
    if (!this.apps.get(preview.appId)) {
      return this.rejectAndClean(preview, {
        code: "APP_MISSING",
        message: "App 已不存在，分享终止",
      });
    }
    /* "prepared" 是准入首档(arbitrate 即推进)；worktree 物证全在不可变 input 里。 */
    const worktree = join(preview.staging, "worktree");
    if (intent.phase === "prepared") {
      if (preview.existingRemote && preview.expectedRemoteHead) {
        const remoteHead = parseLsRemoteHead(
          await this.run("git", ["ls-remote", "origin", "HEAD"], worktree)
        );
        if (remoteHead !== preview.expectedRemoteHead) {
          return this.rejectAndClean(preview, {
            code: "REMOTE_DRIFT",
            message: "远端仓库已变化，请重新生成分享预览",
          });
        }
      }
      /* digest 复核对真实字节：用户确认的是预览时的内容——preview→publish 之间
       * staging 被改（含恢复重入的跨进程窗口），字符串等值的「绑定」就是纸面剧场。 */
      const verified = await inspectPackage(worktree)
        .then((inspection) => packageDigest(worktree, inspection.files))
        .catch(() => null);
      if (verified !== preview.digest) {
        return this.rejectAndClean(preview, {
          code: "STAGING_TAMPERED",
          message: "分享内容与确认时不一致，已拒绝发布，请重新预览",
        });
      }
      await this.run("git", ["config", "user.name", "Bottega"], worktree);
      await this.run("git", ["config", "user.email", "noreply@localhost"], worktree);
      await this.run("git", ["add", "--all"], worktree);
      const changes = await this.run("git", ["status", "--porcelain"], worktree);
      if (changes.trim()) {
        await this.run("git", ["commit", "-m", "Share app package"], worktree);
      }
      if (!preview.existingRemote) {
        const recoveredOrigin = await this.run(
          "git",
          ["remote", "get-url", "origin"],
          worktree
        ).catch(() => null);
        if (!recoveredOrigin?.trim()) {
          try {
            await this.run(
              "gh",
              [
                "repo",
                "create",
                `${preview.targetOwner}/${preview.repoName}`,
                preview.visibility === "private" ? "--private" : "--public",
                "--source",
                ".",
                "--remote",
                "origin",
              ],
              worktree
            );
          } catch (cause) {
            /* 重名是用户可解的业务终态；留 pending 会以 app 级 claim 楔死
             * 后续一切 share 与 app-delete。网络/认证类失败保持可重试。 */
            if (/already exists/i.test(errorText(cause))) {
              return this.rejectAndClean(preview, {
                code: "NAME_TAKEN",
                message:
                  "同名仓库已存在。若它是此前分享创建的空仓库，请先删除或换一个名字后重新预览",
              });
            }
            throw cause;
          }
        }
      }
      /* owner/repo 已过白名单校验，URL 可确定性构造；commit SHA 按契约在 push 前落盘。 */
      const remoteUrl = `https://github.com/${preview.targetOwner}/${preview.repoName}`;
      const commitSha = (
        await this.run("git", ["rev-parse", "HEAD"], worktree)
      ).trim();
      await this.intents.advance(intent.intentId, "remote-created", {
        remoteUrl,
        commitSha,
      });
      intent = (await this.intents.getById(intent.intentId))!;
    }
    if (intent.phase === "remote-created") {
      try {
        await this.run("git", ["push", "-u", "origin", "HEAD"], worktree);
      } catch (cause) {
        /* non-ff = 远端在确认后又前进了：重试永远失败，不 force push 的承诺下
         * 唯一出路是重新预览（clone 会带上新 HEAD）。识别不了的失败保持 pending 重试。 */
        if (
          /non-fast-forward|fetch first|failed to push some refs/i.test(
            errorText(cause)
          )
        ) {
          return this.rejectAndClean(preview, {
            code: "REMOTE_ADVANCED",
            message: "远端仓库在确认后有新提交，请重新生成分享预览再发布",
          });
        }
        throw cause;
      }
      await this.intents.advance(intent.intentId, "pushed");
      intent = (await this.intents.getById(intent.intentId))!;
    }
    if (intent.phase === "pushed") {
      const remoteUrl = String(intent.recoveryState.remoteUrl);
      const saved = await this.apps.update(preview.appId, (record) => ({
        ...record,
        publishedRepoUrl: remoteUrl,
      }));
      await this.intents.advance(intent.intentId, "recorded");
      await rm(preview.staging, { recursive: true, force: true });
      return {
        status: "done",
        value: saved,
        receipt: {
          appId: saved.id,
          publishedRepoUrl: saved.publishedRepoUrl,
          commitSha: intent.recoveryState.commitSha,
        },
      };
    }
    if (intent.phase === "recorded") {
      const record = this.apps.get(preview.appId)!;
      await rm(preview.staging, { recursive: true, force: true });
      return {
        status: "done",
        value: record,
        receipt: {
          appId: record.id,
          publishedRepoUrl: intent.recoveryState.remoteUrl,
          commitSha: intent.recoveryState.commitSha,
        },
      };
    }
    return { status: "interrupted" };
  }

  /** 业务终态统一清 staging：intent 已终结的物证就是垃圾，不留给「也许会来」的 discard。 */
  private async rejectAndClean(
    preview: StoredPreview,
    error: { code: string; message: string }
  ): Promise<SagaResult<AppRecord>> {
    await rm(preview.staging, { recursive: true, force: true });
    return { status: "business-rejected", error };
  }
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export function assertDisjointSampleRows(
  sourceIds: readonly string[],
  sharedIds: readonly string[]
) {
  const source = new Set(sourceIds);
  if (sharedIds.some((id) => source.has(id))) {
    throw new Error("示例/空数据包与真实 row id 相交，已拒绝发布");
  }
}

function requireShareable(record: AppRecord | undefined) {
  if (record?.state !== "ready" || record.manifest?.kind !== "base") {
    throw new Error("只有 ready 的 Base App 可以分享");
  }
  return record;
}

function assertRepoName(value: string) {
  const name = value.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new Error("仓库名无效");
  return name;
}

function assertGithubLogin(value: string) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value)) {
    throw new Error("无法确定 GitHub 发布账号");
  }
  return value;
}

function parsePublishedTarget(value: string) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(value);
  if (!match) throw new Error("publishedRepoUrl 不是受支持的 GitHub 仓库");
  return { owner: assertGithubLogin(match[1]!), repo: assertRepoName(match[2]!) };
}

function parseLsRemoteHead(value: string) {
  const match = /^([0-9a-f]{40})\s+HEAD\s*$/m.exec(value);
  if (!match) throw new Error("无法读取远端 HEAD");
  return match[1]!;
}

async function clearWorktree(root: string) {
  for (const entry of await readdir(root)) {
    if (entry === ".git") continue;
    await rm(join(root, entry), { recursive: true, force: true });
  }
}

function command(executable: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        cwd,
        env: sanitizedProcessEnvironment(),
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120_000,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${executable} ${args[0]} 失败：${stderr.trim()}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}
