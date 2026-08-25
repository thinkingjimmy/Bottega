"use client";

/**
 * [INPUT]: Depends on repo preflight IPC, unified installation disclosures, requirements, common forms, AgentSelect, Apps/Setup Provider and dialog bases
 * [OUTPUT]: Provides AddAppDialog ((self-held page headers + triggers); URL→no-checkout Type and disclose Base/Web, close by probing discard/installing hide
 * [POS]: The only new entry to the apps module; The Chief App is accessed only from the empty shelf, where the GitHub warehouse is exclusively managed; Base is created before Agent selects and with AppRecord
 */

import { useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  AgentSelect,
  type AgentSelectValue,
} from "@/components/apps/agent-select";
import {
  normalizeGithubRepoUrl,
  useApps,
} from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { maintenanceCapableBackends } from "@/lib/agent-backends";
import { errorMessage } from "@/lib/errors";
import { discardAppProbe, probeAppRepo } from "@/lib/apps-client";
import {
  AppRequirementsForm,
  appRequirementsSatisfied,
} from "./app-requirements-form";
import { AppInstallDisclosure } from "./app-install-disclosure";
import type {
  AppConfigValue,
  AppRepoProbeResult,
} from "../../../shared/apps-ipc";

type AddAppDialogProps = {
  onInstallStarted?: (appId: string) => void;
};

type Stage = "blocked" | "form" | "confirm" | "base-confirm";

/* ------------------------------------------------------------------ *
 * 文案表：三态的标题/说明是数据而非分支，读的人一眼看全三种形态
 * ------------------------------------------------------------------ */
const STAGE_TEXT: Record<Stage, { title: string; description: string }> = {
  blocked: {
    title: "添加 App",
    description: "暂时不能运行 App：需要一个已开放 App 维护能力的运行 Agent。",
  },
  form: {
    title: "添加 App",
    description:
      "仅支持公开 GitHub 仓库的默认分支。私有仓库、指定分支和 monorepo 子目录暂不支持。",
  },
  confirm: {
    title: "确认安装风险",
    description: "安装第三方仓库会在本机执行代码，请先确认信任边界。",
  },
  "base-confirm": {
    title: "确认导入 Base App",
    description:
      "已冻结远端提交并完成无 checkout 校验。请审阅指令、数据与依赖后确认。",
  },
};

/* 字段外壳：标题与控件的唯一排版来源，控件用 aria-labelledby 认领它 */
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="font-medium text-xs">
        {label}
      </span>
      {children}
    </div>
  );
}

/* 能力徽章：开放=绿，其余一律琥珀，颜色即结论 */
function CapabilityBadge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={
        ok
          ? "flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 py-0.5 pr-2 pl-1.5 font-medium text-[11px] text-emerald-700 dark:text-emerald-400"
          : "flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 py-0.5 pr-2 pl-1.5 font-medium text-[11px] text-amber-700 dark:text-amber-400"
      }
    >
      <span
        aria-hidden="true"
        className={
          ok
            ? "size-1.5 rounded-full bg-emerald-500"
            : "size-1.5 rounded-full bg-amber-500"
        }
      />
      {text}
    </span>
  );
}

export function AddAppDialog({ onInstallStarted }: AddAppDialogProps) {
  const { t } = useAppTranslation();
  const { records, addApp, highlightApp } = useApps();
  const setup = useSetup();
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [normalized, setNormalized] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<AppRepoProbeResult | null>(null);
  const [config, setConfig] = useState<AppConfigValue>({
    values: {},
    agentReadableKeys: [],
  });
  const backends = setup.status?.backends ?? [];
  const maintenanceBackends = maintenanceCapableBackends(backends);
  const canInstall = maintenanceBackends.length > 0;
  const [maintenanceAgent, setMaintenanceAgent] =
    useState<AgentSelectValue>("codex");
  const probeAttempt = useRef(0);
  /* preflight 一旦提交给 main，ownership 已转入 durable import intent。 */
  const installing = useRef(false);

  const reset = (discardPreflight = true) => {
    probeAttempt.current += 1;
    if (discardPreflight && probe?.kind === "base") {
      void discardAppProbe(probe.preflightId);
    }
    installing.current = false;
    setRepoUrl("");
    setNormalized("");
    setError("");
    setSaving(false);
    setProbing(false);
    setProbe(null);
    setConfig({ values: {}, agentReadableKeys: [] });
    setMaintenanceAgent("codex");
  };

  const maintenanceReady = (backend: (typeof backends)[number]) =>
    maintenanceBackends.some((candidate) => candidate.id === backend.id);
  const maintenanceLabel = (backend: (typeof backends)[number]) =>
    backend.runtimeStatus !== "installed"
      ? "未安装或版本不可用"
      : backend.authStatus !== "authenticated"
        ? "待登录"
      : maintenanceReady(backend)
        ? "已开放运行"
        : "未开放运行";

  const review = async () => {
    if (probing) return;
    const attempt = ++probeAttempt.current;
    setProbing(true);
    try {
      const next = normalizeGithubRepoUrl(repoUrl);
      const duplicate = records.find(
        (record) => record.sourceRepoUrl === next
      );
      if (duplicate) {
        highlightApp(duplicate.id);
        throw new Error("该仓库已添加，已在列表中高亮");
      }
      setNormalized(next);
      const result = await probeAppRepo(next);
      if (attempt !== probeAttempt.current) {
        if (result.kind === "base") {
          await discardAppProbe(result.preflightId).catch(() => undefined);
        }
        return;
      }
      setProbe(result);
      setError("");
    } catch (cause) {
      if (attempt !== probeAttempt.current) return;
      setError(errorMessage(cause, "仓库地址无效"));
    } finally {
      if (attempt === probeAttempt.current) setProbing(false);
    }
  };

  const install = async () => {
    if (installing.current) return;
    if (!setup.ready) {
      setOpen(false);
      setup.openOnboarding();
      return;
    }
    installing.current = true;
    setSaving(true);
    setError("");
    try {
      const app = await addApp({
        repoUrl: normalized,
        maintenanceAgent,
        ...(probe?.kind === "base"
          ? {
              preflightId: probe.preflightId,
              confirmedDigest: probe.digest,
              config,
            }
          : {}),
      });
      setOpen(false);
      reset(false);
      onInstallStarted?.(app.id);
    } catch (cause) {
      const message = errorMessage(cause, "添加 App 失败");
      const duplicateId = message.match(/已添加：([a-z0-9]{10})/)?.[1];
      if (duplicateId) highlightApp(duplicateId);
      /* 已提交的 preflight 不可由 renderer 重放或 discard；重试归 App intent。 */
      setProbe(null);
      setNormalized("");
      setConfig({ values: {}, agentReadableKeys: [] });
      setError(message);
    } finally {
      installing.current = false;
      setSaving(false);
    }
  };

  const ownerRepo = normalized.replace("https://github.com/", "");
  const cliRequirementsReady =
    probe?.kind !== "base" ||
    probe.requirements
      .filter((requirement) => requirement.kind === "cli" && requirement.required)
      .every((requirement) => {
        const status = probe.cliStatuses.find(
          (candidate) => candidate.id === requirement.id
        );
        return status?.detectable !== true || status.installed;
      });
  const stage: Stage =
    probe?.kind === "base"
      ? "base-confirm"
      : probe?.kind === "web"
        ? canInstall
          ? "confirm"
          : "blocked"
        : "form";

  /* 动作表：按钮的文案/禁用/回调按 stage 取值，footer 因此没有一个分支 */
  const actions = {
    blocked: {
      secondary: {
        label: setup.checking ? "正在检测…" : "重新检测",
        disabled: setup.checking,
        run: () => void setup.recheck(),
      },
      primary: {
        label: "打开 Agent 设置",
        disabled: false,
        run: () => {
          setOpen(false);
          setup.openOnboarding();
        },
      },
    },
    form: {
      secondary: {
        label: "取消",
        disabled: false,
        run: () => {
          setOpen(false);
          reset();
        },
      },
      primary: {
        label: probing ? "正在安全预检…" : "继续",
        disabled: probing || !repoUrl.trim(),
        run: () => void review(),
      },
    },
    confirm: {
      secondary: {
        label: "返回",
        disabled: saving,
        run: () => {
          setNormalized("");
          setError("");
        },
      },
      primary: {
        label: saving ? "正在提交…" : "下载并安装",
        disabled: saving,
        run: () => void install(),
      },
    },
    "base-confirm": {
      secondary: {
        label: "返回",
        disabled: saving,
        run: () => {
          if (probe?.kind === "base") void discardAppProbe(probe.preflightId);
          setProbe(null);
          setNormalized("");
          setError("");
        },
      },
      primary: {
        label: saving ? "正在导入…" : "导入 Base App",
        disabled:
          saving ||
          !maintenanceBackends.some(
            (backend) => backend.id === maintenanceAgent
          ) ||
          !appRequirementsSatisfied(
            probe?.kind === "base" ? probe.requirements : [],
            config
          ) ||
          !cliRequirementsReady,
        run: () => void install(),
      },
    },
  }[stage];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && addAppCloseDisposition(installing.current) === "reset") {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button aria-label={t("apps.addApp")} size="icon-sm" variant="ghost">
          <Plus />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{STAGE_TEXT[stage].title}</DialogTitle>
          <DialogDescription>{STAGE_TEXT[stage].description}</DialogDescription>
        </DialogHeader>

        {stage === "blocked" ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">
              运行 Agent 会在本机无人值守地安装、修复并运行此 App，
              因此后端必须实现维护适配器并通过能力门禁；若某些围栏无法强制，
              只能在你明确接受并已记录风险例外后开放。
            </p>
            <ul className="flex flex-col gap-2 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
              {backends.map((backend) => (
                <li
                  key={backend.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="font-medium">{backend.displayName}</span>
                  <CapabilityBadge
                    ok={maintenanceReady(backend)}
                    text={maintenanceLabel(backend)}
                  />
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              符合能力门禁或已有明确风险例外的 Agent 就绪后，此入口将自动开放。
            </p>
          </div>
        ) : stage === "base-confirm" && probe?.kind === "base" ? (
          <SlimScroller className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {probe.manifest.icon} {probe.manifest.name}
              </p>
              <p className="text-muted-foreground">
                {probe.manifest.description}
              </p>
              <p>{probe.files.length} 个文件 · {probe.rowCount} 行</p>
              {probe.hasGui && (
                <p className="mt-2 rounded bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300">
                  包含自定义 GUI，将在受限 iframe 沙箱内执行。
                </p>
              )}
            </div>
            <AppInstallDisclosure
              cliStatuses={probe.cliStatuses}
              extensions={probe.extensionPreflights}
              extensionRequirements={probe.manifest.extensionRequirements}
              readme={probe.disclosures.find((item) => item.path === "README.md")?.content ?? ""}
              requirements={probe.requirements}
              source={{
                label: probe.repoUrl,
                fingerprint: `${probe.commitSha.slice(0, 12)} · ${probe.digest.slice(0, 12)}`,
              }}
            />
            <Field id="base-agent" label="使用 Agent">
              <AgentSelect
                value={maintenanceAgent}
                options={maintenanceBackends}
                labelledBy="base-agent-label"
                onChange={setMaintenanceAgent}
              />
            </Field>
            <AppRequirementsForm
              disabled={saving}
              onChange={setConfig}
              requirements={probe.requirements}
              value={config}
            />
            {probe.cliStatuses.length > 0 && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">本机 CLI 检测</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {probe.cliStatuses.map((status) => {
                    const requirement = probe.requirements.find(
                      (candidate) =>
                        candidate.kind === "cli" && candidate.id === status.id
                    );
                    const ready = status.detectable && status.installed;
                    return (
                      <li
                        className="flex items-center justify-between gap-3"
                        key={status.id}
                      >
                        <span>
                          {requirement?.label ?? status.id}
                          {requirement?.required ? "（必需）" : "（可选）"}
                        </span>
                        <CapabilityBadge
                          ok={ready}
                          text={
                            !status.detectable
                              ? "未内置检测器"
                              : status.installed
                                ? "已安装"
                                : "未安装"
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
                {!cliRequirementsReady && (
                  <p className="mt-2 text-destructive text-xs" role="alert">
                    必需 CLI 未通过检测，暂不能导入。
                  </p>
                )}
              </div>
            )}
            {probe.disclosures.map((item) => (
              <details className="rounded-lg border p-3 text-sm" key={item.path}>
                <summary className="cursor-pointer font-mono">{item.path}</summary>
                <SlimScroller asChild>
                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs">
                    {item.content}
                  </pre>
                </SlimScroller>
              </details>
            ))}
            {probe.ignored.length > 0 && (
              <p className="text-muted-foreground text-xs">
                将丢弃白名单外文件：{probe.ignored.join("、")}
              </p>
            )}
          </SlimScroller>
        ) : stage === "confirm" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
              <span className="text-muted-foreground">即将下载并安装</span>
              <span className="font-mono text-sm break-all">{ownerRepo}</span>
            </div>
            <p className="rounded-lg bg-amber-500/10 p-3 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300">
              <strong className="font-medium">
                安装与运行均以你的用户权限执行（可读写文件、访问网络）。
              </strong>
              仅添加你信任的仓库。
            </p>
            <Field id="maintenance-agent" label="运行 Agent">
              <AgentSelect
                value={maintenanceAgent}
                options={maintenanceBackends}
                labelledBy="maintenance-agent-label"
                onChange={setMaintenanceAgent}
              />
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field id="repo-url" label="仓库地址">
              <Input
                autoFocus
                id="repo-url"
                aria-labelledby="repo-url-label"
                aria-describedby={error ? "add-app-error" : undefined}
                aria-invalid={Boolean(error)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(event) => {
                  setRepoUrl(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => event.key === "Enter" && review()}
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              下一步先以 no-checkout 方式读取 Git 对象并判型；此时不会运行仓库代码，也不会创建 App。
            </p>
          </div>
        )}

        {error && (
          <p
            id="add-app-error"
            role="alert"
            className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-destructive text-xs ring-1 ring-destructive/20"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={actions.secondary.disabled}
            onClick={actions.secondary.run}
          >
            {actions.secondary.label}
          </Button>
          <Button
            disabled={actions.primary.disabled}
            onClick={actions.primary.run}
          >
            {actions.primary.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Radix close 是 UI 意图，不等于取消 main-owned durable 安装。 */
export const addAppCloseDisposition = (installing: boolean) =>
  installing ? "hide" as const : "reset" as const;
