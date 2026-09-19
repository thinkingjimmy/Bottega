"use client";

/**
 * [INPUT]: Depends on the shared AppDialog shell, repo preflight IPC, the shared GitHub repo URL normalizer, Apps i18n, the install grant card plus a local README disclosure, requirements, AgentSelect, Apps/Setup providers, and dialog primitives
 * [OUTPUT]: Provides source preflight and authorization with a request-bound host reminder, one-shot latest-candidate selection and focus restoration to the return entry.
 * [POS]: Sole Apps creation entry; renderer owns review UI while main owns submitted durable install intents
 */

import { CompatibilityReminder } from "../compatibility/reminder";
import { AppCompatibilityRequiredError, resumeAppCompatibility, forgetAppCompatibility, listAppCompatibilityRequests } from "@/lib/apps-client";
import type { AppCompatibilityFailure } from "../../../../shared/app-host/contract";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
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
} from "@/components/apps/install/agent-select";
import { useApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { maintenanceCapableBackends } from "@/lib/agent-backends";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { normalizeGithubRepoUrl } from "../../../../shared/github-repo";
import {
  discardAppProbe,
  DuplicateAppError,
  probeAppRepo,
} from "@/lib/apps-client";
import {
  AppRequirementsForm,
  appRequirementsSatisfied,
} from "./app-requirements-form";
import {
  AppInstallGrants,
  AppInstallReadme,
  hasInstallReadme,
} from "./app-install-disclosure";
import type {
  AppConfigValue,
  AppRepoProbeResult,
} from "../../../../shared/apps-ipc";
import { canonicalAppSurfaceRoute } from "../../../../shared/window-surfaces-ipc";

type AddAppDialogProps = {
  onInstallStarted?: (appId: string) => void;
  resumeRequestId?: string;
  onResumeClosed?(): void;
};

type Stage = "blocked" | "form" | "confirm" | "base-confirm";

/* ------------------------------------------------------------------ *
 * 文案表：三态的标题/说明是数据而非分支，读的人一眼看全三种形态
 * ------------------------------------------------------------------ */
const STAGE_TEXT: Record<Stage, { titleKey: string; descriptionKey: string }> = {
  blocked: {
    titleKey: "apps.addDialog.blockedTitle",
    descriptionKey: "apps.addDialog.blockedDescription",
  },
  form: {
    titleKey: "apps.addDialog.formTitle",
    descriptionKey: "apps.addDialog.formDescription",
  },
  confirm: {
    titleKey: "apps.addDialog.confirmTitle",
    descriptionKey: "apps.addDialog.confirmDescription",
  },
  "base-confirm": {
    titleKey: "apps.installAuthorizationTitle",
    descriptionKey: "apps.installAuthorizationDescription",
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

/* README 在这个弹窗里仍旧收在抽屉里，与预设弹窗不同：那边确认页只有说明书
   与授权卡两件事，这边后面还排着 Agent 选择、需求表单和 CLI 体检——把一整篇
   陌生仓库的 README 摊开，会把真正要填的东西推到三屏之外。
   空正文不给空抽屉：判据借 hasInstallReadme，与预设弹窗同一个。 */
function BaseReadmeDisclosure({ readme }: { readme: string }) {
  const { t } = useAppTranslation();
  if (!hasInstallReadme(readme)) return null;
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {t("apps.installAboutApp")}
      </summary>
      <AppInstallReadme className="mt-4" readme={readme} />
    </details>
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

export function AddAppDialog({ onInstallStarted, resumeRequestId, onResumeClosed }: AddAppDialogProps) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { records, addApp, highlightApp } = useApps();
  const setup = useSetup();
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [normalized, setNormalized] = useState("");
  const [compatibility, setCompatibility] = useState<AppCompatibilityFailure | null>(null);
  const [candidateUnavailable, setCandidateUnavailable] = useState(false);
  const [candidateRequestId, setCandidateRequestId] = useState(resumeRequestId);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<AppRepoProbeResult | null>(null);
  const [config, setConfig] = useState<AppConfigValue>({
    values: {},
    agentReadableKeys: [],
  });
  const backends = setup.status?.backends ?? [];
  const maintenanceBackends = maintenanceCapableBackends(backends, setup.now);
  const canInstall = maintenanceBackends.length > 0;
  const [agentAnalysis, setAgentAnalysis] = useState(false);
  const [maintenanceAgent, setMaintenanceAgent] =
    useState<AgentSelectValue>("codex");
  const probeAttempt = useRef(0);
  const resumeFocus = useRef<HTMLElement | null>(null);
  /* preflight 一旦提交给 main，ownership 已转入 durable import intent。 */
  const installing = useRef(false);
  const rememberCompatibility = useCallback((failure: AppCompatibilityFailure) => {
    setCompatibility(failure);
    setCandidateRequestId(failure.requestId);
    setRepoUrl(failure.candidate.repoUrl ?? "");
    setProbe(null);
    setCandidateUnavailable(false);
  }, []);

  const reset = (discardPreflight = true) => {
    probeAttempt.current += 1;
    if (discardPreflight && probe?.kind === "base") {
      void discardAppProbe(probe.preflightId);
    }
    installing.current = false;
    setCompatibility(null);
    setCandidateUnavailable(false);
    setCandidateRequestId(undefined);
    onResumeClosed?.();
    setRepoUrl("");
    setNormalized("");
    setError("");
    setSaving(false);
    setProbing(false);
    setProbe(null);
    setConfig({ values: {}, agentReadableKeys: [] });
    setMaintenanceAgent("codex");
    setAgentAnalysis(false);
  };

  useEffect(() => {
    if (!resumeRequestId) return;
    let active = true;
    resumeFocus.current = document.activeElement as HTMLElement | null;
    // An external resume intent opens this dialog after capturing its return focus.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidateRequestId(resumeRequestId);
    setOpen(true);
    setProbing(true);
    void listAppCompatibilityRequests().then(async (entries) => {
      const saved = entries.find((entry) => entry.requestId === resumeRequestId);
      if (active && saved?.candidate.repoUrl) setRepoUrl(saved.candidate.repoUrl);
      return resumeAppCompatibility(resumeRequestId);
    }).then((result) => {
      if (!active) {
        if (result.kind === "base") void discardAppProbe(result.preflightId);
        return;
      }
      if (result.kind === "candidate-unavailable" || result.kind === "installed-update") { setCandidateUnavailable(true); setError(t("appHost.candidateUnavailable")); return; }
      setProbe(result);
      setRepoUrl(result.repoUrl);
      setNormalized(result.repoUrl);
    }).catch((cause) => {
      if (!active) return;
      if (cause instanceof AppCompatibilityRequiredError) rememberCompatibility(cause.compatibility);
      else setError(errorMessage(cause, t("appHost.candidateUnavailable")));
    }).finally(() => { if (active) setProbing(false); });
    return () => { active = false; };
  }, [resumeRequestId, t, rememberCompatibility]);

  const maintenanceReady = (backend: (typeof backends)[number]) =>
    maintenanceBackends.some((candidate) => candidate.id === backend.id);
  const maintenanceLabel = (backend: (typeof backends)[number]) =>
    backend.runtimeStatus !== "installed"
      ? t("apps.addDialog.backendUnavailable")
      : backend.authStatus !== "authenticated"
        ? t("apps.addDialog.backendLoginRequired")
      : maintenanceReady(backend)
        ? t("apps.addDialog.backendReady")
        : t("apps.addDialog.backendBlocked");

  const review = async (latest = false) => {
    if (probing) return;
    const attempt = ++probeAttempt.current;
    setProbing(true);
    try {
      const next = normalizeGithubRepoUrl(repoUrl).repoUrl;
      const duplicate = records.find(
        (record) => record.sourceRepoUrl === next
      );
      if (duplicate) {
        highlightApp(duplicate.id);
        throw new Error(t("apps.addDialog.duplicateRepository"));
      }
      setNormalized(next);
      if (latest) setCandidateRequestId(undefined);
      const result = candidateRequestId && !latest ? await resumeAppCompatibility(candidateRequestId) : await probeAppRepo(next);
      if (attempt !== probeAttempt.current) {
        if (result.kind === "base") {
          await discardAppProbe(result.preflightId).catch(() => undefined);
        }
        return;
      }
      if (result.kind === "candidate-unavailable" || result.kind === "installed-update") { setCompatibility(null); setProbe(null); setCandidateUnavailable(true); setError(t("appHost.candidateUnavailable")); return; }
      setCompatibility(null);
      setCandidateUnavailable(false);
      setProbe(result);
      setError("");
    } catch (cause) {
      if (attempt !== probeAttempt.current) return;
      if (cause instanceof AppCompatibilityRequiredError) rememberCompatibility(cause.compatibility);
      else setError(errorMessage(cause, t("apps.addDialog.invalidRepository")));
    } finally {
      if (attempt === probeAttempt.current) setProbing(false);
    }
  };

  const install = async () => {
    if (installing.current) return;
    if (!setup.ready && (probe?.kind !== "web" || agentAnalysis)) {
      setOpen(false);
      setup.openOnboarding("agent");
      return;
    }
    installing.current = true;
    setSaving(true);
    setError("");
    const installingBase = probe?.kind === "base";
    try {
      const app = await addApp({
        repoUrl: normalized,
        maintenanceAgent,
        ...(probe?.kind === "web" ? { candidateCommitSha: probe.commitSha, installStrategy: agentAnalysis ? "agent-analysis" as const : "author-manifest" as const } : {}),
        ...(probe?.kind === "base"
          ? {
              preflightId: probe.preflightId,
              confirmedDigest: probe.digest,
              config,
              authorization: {
                scope: "studio-only",
                decision: "approve-requested",
              },
            }
          : {}),
      });
      for (const requestId of new Set([resumeRequestId, candidateRequestId])) {
        if (requestId) await forgetAppCompatibility(requestId);
      }
      setOpen(false);
      reset(false);
      if (installingBase) navigate(canonicalAppSurfaceRoute(app.id));
      else onInstallStarted?.(app.id);
    } catch (cause) {
      if (cause instanceof AppCompatibilityRequiredError) { rememberCompatibility(cause.compatibility); return; }
      const duplicateId =
        cause instanceof DuplicateAppError ? cause.appId : null;
      if (duplicateId) highlightApp(duplicateId);
      const message = duplicateId
        ? t("apps.addDialog.duplicateRepository")
        : errorMessage(cause, t("apps.addDialog.addFailed"));
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
        ? !agentAnalysis || canInstall
          ? "confirm"
          : "blocked"
        : "form";

  /* 动作表：按钮的文案/禁用/回调按 stage 取值，footer 因此没有一个分支 */
  const actions = {
    blocked: {
      secondary: {
        label: setup.checking
          ? t("apps.addDialog.checking")
          : t("apps.addDialog.recheck"),
        disabled: setup.checking,
        run: () => void setup.recheck(),
      },
      primary: {
        label: t("apps.addDialog.openAgentSettings"),
        disabled: false,
        run: () => {
          setOpen(false);
          setup.openOnboarding("agent");
        },
      },
    },
    form: {
      secondary: {
        label: t("common.cancel"),
        disabled: false,
        run: () => {
          setOpen(false);
          reset();
        },
      },
      primary: {
        label: probing
          ? t("apps.addDialog.preflighting")
          : t(candidateUnavailable ? "appHost.checkLatest" : "common.continue"),
        disabled: probing || !repoUrl.trim(),
        run: () => void review(candidateUnavailable),
      },
    },
    confirm: {
      secondary: {
        label: t("common.back"),
        disabled: saving,
        run: () => {
          /* stage 由 probe 判，不由 normalized 判：只清 normalized 只会把
             人留在一张空表单上，而那颗「下载并安装」仍然亮着——回到表单
             就该回到没探测过的那一刻，两个字段是同一次探测的两半。 */
          setProbe(null);
          setNormalized("");
          setError("");
        },
      },
      primary: {
        label: saving
          ? t("apps.addDialog.submitting")
          : t("apps.addDialog.downloadAndInstall"),
        disabled: saving,
        run: () => void install(),
      },
    },
    "base-confirm": {
      secondary: {
        label: t("common.back"),
        disabled: saving,
        run: () => {
          if (probe?.kind === "base") void discardAppProbe(probe.preflightId);
          setProbe(null);
          setNormalized("");
          setError("");
        },
      },
      primary: {
        label: saving
          ? t("apps.presetInstalling")
          : t("apps.presetAllowAndInstall"),
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
        /* Radix close 是 UI 意图，不等于取消 main-owned durable 安装：
           安装在途时只藏起弹窗，不动那笔已提交的意图。 */
        if (!next && !installing.current) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button aria-label={t("apps.addApp")} size="icon-sm" variant="ghost">
          <Plus />
        </Button>
      </DialogTrigger>
      {/* 这张弹窗此前独自留在旧外壳上：448px、12px 正文、黑 80% 加模糊的
          遮罩、h-7 的页脚。它与 Save as App、Share、Delete 是同一族——一张
          问「装哪个仓库」的表单，没有理由自成一格。 */}
      <AppDialogContent onCloseAutoFocus={(event) => {
        if (resumeFocus.current) { event.preventDefault(); resumeFocus.current.focus(); resumeFocus.current = null; }
      }}>
        {compatibility ? <CompatibilityReminder failure={compatibility} onClose={() => { setOpen(false); reset(); }} onRetry={() => { setCompatibility(null); void review(); }} /> : <>
        <DialogHeader className="mb-4 shrink-0 gap-0 text-left">
          <DialogTitle className="text-xl/7 font-semibold">
            {t(
              STAGE_TEXT[stage].titleKey,
              stage === "base-confirm" && probe?.kind === "base"
                ? { name: probe.manifest.name }
                : undefined
            )}
          </DialogTitle>
          <DialogDescription className="mt-3 text-[15px]/[1.4]">
            {t(STAGE_TEXT[stage].descriptionKey)}
          </DialogDescription>
        </DialogHeader>
        {/* 旧外壳自己就是滚动容器（overflow-y-auto 直接挂在圆角盒上，系统
            滚动条会骑在弧线上）。新外壳把滚动交给正文层，gap-4 则接回从前
            由 DialogContent 的 grid 提供的那 16px 段距。 */}
        <AppDialogBody className="flex flex-col gap-4">

        {stage === "blocked" ? (
          <div className="flex flex-col gap-3">
            <Button variant="outline" onClick={() => setAgentAnalysis(false)}>{t("apps.addDialog.authorManifestInstall")}</Button>
            <p className="text-muted-foreground">
              {t("apps.addDialog.blockedDisclosure")}
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
              {t("apps.addDialog.blockedReadyHint")}
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
              <p>
                {t("apps.addDialog.fileSummary", {
                  files: probe.files.length,
                  rows: probe.rowCount,
                })}
              </p>
              {probe.hasGui && (
                <p className="mt-2 rounded bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300">
                  {t("apps.addDialog.customGui")}
                </p>
              )}
            </div>
            <AppInstallGrants
              manifest={probe.manifest}
              cliStatuses={probe.cliStatuses}
              extensions={probe.extensionPreflights}
              extensionRequirements={probe.manifest.extensionRequirements}
              requirements={probe.requirements}
              source={{
                label: probe.repoUrl,
                fingerprint: `${probe.commitSha.slice(0, 12)} · ${probe.digest.slice(0, 12)}`,
              }}
            />
            <BaseReadmeDisclosure
              readme={probe.disclosures.find((item) => item.path === "README.md")?.content ?? ""}
            />
            <Field id="base-agent" label={t("apps.addDialog.useAgent")}>
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
                <p className="font-medium">{t("apps.addDialog.cliCheck")}</p>
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
                          {t(
                            requirement?.required
                              ? "apps.addDialog.required"
                              : "apps.addDialog.optional"
                          )}
                        </span>
                        <CapabilityBadge
                          ok={ready}
                          text={
                            !status.detectable
                              ? t("apps.addDialog.detectorUnavailable")
                              : status.installed
                                ? t("apps.addDialog.installed")
                                : t("apps.addDialog.notInstalled")
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
                {!cliRequirementsReady && (
                  <p className="mt-2 text-destructive text-xs" role="alert">
                    {t("apps.addDialog.requiredCliBlocked")}
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
                {t("apps.addDialog.ignoredFiles", {
                  files: probe.ignored.join(", "),
                })}
              </p>
            )}
          </SlimScroller>
        ) : stage === "confirm" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
              <span className="text-muted-foreground">
                {t("apps.addDialog.aboutToInstall")}
              </span>
              <span className="font-mono text-sm break-all">{ownerRepo}</span>
            </div>
            <p className="rounded-lg bg-amber-500/10 p-3 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300">
              <strong className="font-medium">
                {t("apps.addDialog.permissionsWarning")}
              </strong>
              {" "}{t("apps.addDialog.trustedOnly")}
            </p>
            <p className="text-muted-foreground text-xs">{t("apps.addDialog.authorManifestHint")}</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={agentAnalysis} disabled={!canInstall || saving}
                onChange={(event) => setAgentAnalysis(event.target.checked)} />
              {t("apps.addDialog.agentAnalysis")}
            </label>
            {agentAnalysis && <Field
              id="maintenance-agent"
              label={t("apps.addDialog.runtimeAgent")}
            >
              <AgentSelect
                value={maintenanceAgent}
                options={maintenanceBackends}
                labelledBy="maintenance-agent-label"
                onChange={setMaintenanceAgent}
              />
            </Field>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field id="repo-url" label={t("apps.addDialog.repositoryAddress")}>
              <Input
                autoFocus
                id="repo-url"
                aria-labelledby="repo-url-label"
                aria-describedby={error ? "add-app-error" : undefined}
                aria-invalid={Boolean(error)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                size="lg"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(event) => {
                  setRepoUrl(event.target.value);
                  setCandidateRequestId(undefined);
                  setCandidateUnavailable(false);
                  setError("");
                }}
                onKeyDown={(event) => event.key === "Enter" && review()}
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              {t("apps.addDialog.nextStep")}
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

        </AppDialogBody>

        <DialogFooter className="mt-4 shrink-0 sm:gap-3">
          <Button
            size="pill"
            variant="outline"
            disabled={actions.secondary.disabled}
            onClick={actions.secondary.run}
          >
            {actions.secondary.label}
          </Button>
          <Button
            size="pill"
            disabled={actions.primary.disabled}
            onClick={actions.primary.run}
          >
            {actions.primary.label}
          </Button>
        </DialogFooter>
        </>}
      </AppDialogContent>
    </Dialog>
  );
}
