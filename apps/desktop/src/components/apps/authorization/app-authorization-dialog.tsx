"use client";

/**
 * [INPUT]: Depends on the main-owned App grant candidate projection, fenced grant commands, shared dialog/settings primitives, and renderer i18n
 * [OUTPUT]: Provides AppAuthorizationDialog, the two-step add/edit authorization workflow shared by Project and Chat surfaces
 * [POS]: Single renderer authorization workflow for contextual App attachment; step one only answers "which App", step two only answers "what may it see"
 */

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  LoaderCircle,
} from "lucide-react";
import { AppDialogBody, AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  isPositiveAppGrant,
  type AppCapabilityGrant,
  type AppGrantCandidate,
  type AppGrantCommandTarget,
} from "../../../../shared/apps-ipc";
import {
  APP_DATA_LEVELS,
  APP_DATA_LEVEL_DETAIL_KEYS,
  APP_DATA_LEVEL_KEYS,
  APP_DATA_LEVEL_OUTCOME_KEYS,
  type AppDataLevel,
} from "../data-levels";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsBadge,
  SettingsChoiceRow,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import {
  grantApp,
  listAppGrantCandidates,
  setAppGrantState,
} from "@/lib/apps-client";

type AuthorizationMode = "inherited" | "custom";

/* 没有已开 App 时的空清单：默认参数每渲染一次就新造一个数组，而它曾落在
   useMemo 的依赖里——恒等的空数组比一份「每次都新」的空数组诚实。 */
const NO_OPEN_APPS: readonly string[] = [];

type AppAuthorizationDialogProps = Readonly<{
  open: boolean;
  onOpenChange(open: boolean): void;
  target: AppGrantCommandTarget;
  mode: "add" | "edit";
  appId?: string;
  openAppIds?: readonly string[];
  onCommitted?(appId: string): void | Promise<void>;
  onRemoved?(appId: string): void | Promise<void>;
}>;

export function AppAuthorizationDialog({
  open,
  ...props
}: AppAuthorizationDialogProps) {
  if (!open) return null;
  return (
    <AppAuthorizationDialogSession
      key={dialogSessionKey(props)}
      open
      {...props}
    />
  );
}

function AppAuthorizationDialogSession({
  open,
  onOpenChange,
  target,
  mode,
  appId,
  openAppIds = NO_OPEN_APPS,
  onCommitted,
  onRemoved,
}: AppAuthorizationDialogProps) {
  const { t } = useAppTranslation();
  /* Session 只在一次打开期间存在，围栏因此与用户看到的候选快照同寿命；
     父组件无关重渲染不能把提交目标悄悄换成另一代。 */
  const [stableTarget] = useState<AppGrantCommandTarget>(() => ({ ...target }));
  const [candidates, setCandidates] = useState<AppGrantCandidate[]>([]);
  const [selectedId, setSelectedId] = useState(appId ?? "");
  const [step, setStep] = useState<"select" | "authorize">(
    mode === "edit" ? "authorize" : "select"
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAppId, setSavedAppId] = useState("");
  const [savedOperation, setSavedOperation] = useState<"committed" | "removed">("committed");
  const [authorizationMode, setAuthorizationMode] =
    useState<AuthorizationMode>("custom");
  const [dataLevel, setDataLevel] = useState<AppDataLevel>("none");
  const [delegated, setDelegated] = useState(false);

  useEffect(() => {
    let active = true;
    void listAppGrantCandidates({ target: stableTarget }).then(
      (loaded) => {
        if (!active) return;
        setCandidates(loaded);
        const initial = loaded.find((candidate) => candidate.appId === appId);
        if (initial) {
          const draft = authorizationDraft(initial, stableTarget.kind);
          setAuthorizationMode(draft.mode);
          setDataLevel(draft.dataLevel);
          setDelegated(draft.delegated);
        }
        setLoading(false);
      },
      (cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : t("apps.authorization.loadFailed")
        );
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, [appId, stableTarget, t]);

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.appId === selectedId),
    [candidates, selectedId]
  );

  const unavailableReason = (candidate: AppGrantCandidate) => {
    if (candidate.state !== "ready") {
      return t("apps.authorization.lifecycleUnavailable", {
        state: t(`apps.state.${candidate.state}`),
      });
    }
    if (!candidate.generationId) return t("apps.authorization.noGeneration");
    if (openAppIds.includes(candidate.appId)) {
      return t("apps.authorization.alreadyOpen");
    }
    if (
      stableTarget.kind === "project" &&
      candidate.scopeRecord &&
      isPositiveAppGrant(candidate.scopeRecord)
    ) {
      return t("apps.authorization.alreadyAdded");
    }
    return "";
  };
  /* 「能不能选」与「为什么不能选」是同一个判断的两次朗读：从前它们是两个
     函数，条件逐字重写了一遍——两份都对，直到有一天只改了其中一份。 */
  const firstSelectableId =
    candidates.find((candidate) => !unavailableReason(candidate))?.appId ?? "";

  const close = () => {
    if (!busy) onOpenChange(false);
  };

  const finish = async (
    selectedAppId: string,
    operation: "committed" | "removed",
    after: ((id: string) => void | Promise<void>) | undefined
  ) => {
    setSavedAppId(selectedAppId);
    setSavedOperation(operation);
    try {
      await after?.(selectedAppId);
      onOpenChange(false);
    } catch {
      setError(t("apps.authorization.savedRefreshFailed"));
    }
  };

  const retryFinish = async () => {
    if (!savedAppId) return;
    setBusy(true);
    setError("");
    try {
      await (savedOperation === "removed" ? onRemoved : onCommitted)?.(savedAppId);
      onOpenChange(false);
    } catch {
      setError(t("apps.authorization.savedRefreshFailed"));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected || savedAppId) return;
    setBusy(true);
    setError("");
    try {
      if (authorizationMode === "inherited") {
        if (selected.scopeRecord) {
          await setAppGrantState({
            appId: selected.appId,
            target: stableTarget,
            state: "clear",
          });
        }
      } else {
        await grantApp({
          appId: selected.appId,
          target: stableTarget,
          requestedDataLevel: dataLevel,
          requestedAgentDelegation: delegated
            ? { fileRead: true, useData: dataLevel !== "none" }
            : { fileRead: false, useData: false },
        });
      }
      await finish(selected.appId, "committed", onCommitted);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("apps.authorization.saveFailed")
      );
    } finally {
      setBusy(false);
    }
  };

  const setScopeState = async (state: "disabled" | "clear") => {
    if (!selected || savedAppId) return;
    setBusy(true);
    setError("");
    try {
      await setAppGrantState({ appId: selected.appId, target: stableTarget, state });
      await finish(
        selected.appId,
        state === "disabled" ? "removed" : "committed",
        state === "disabled" ? onRemoved : onCommitted
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("apps.authorization.saveFailed")
      );
    } finally {
      setBusy(false);
    }
  };

  const choose = (candidate: AppGrantCandidate) => {
    if (unavailableReason(candidate)) return;
    const draft = authorizationDraft(candidate, stableTarget.kind);
    setSelectedId(candidate.appId);
    setAuthorizationMode(draft.mode);
    setDataLevel(draft.dataLevel);
    setDelegated(draft.delegated);
    setError("");
  };

  const selecting = step === "select";
  const hasData = selected?.domainIdentity?.kind === "base";
  /* 继承是机制，不是答案。第一步只回答「选谁」，所以「不动它会落在哪」
     降级成第二步对应档位上的一枚徽标——用户不必先学会「继承」。 */
  const inheritedLevel = selected?.inheritedGrant
    ? selected.inheritedGrant.data?.level ?? "none"
    : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <AppDialogContent
        aria-busy={busy || loading || undefined}
        className="sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 gap-0 text-left">
          <DialogTitle>
            {selecting
              ? t("apps.authorization.selectTitle")
              : t("apps.authorization.settingsTitle", {
                  name: selected?.name ?? "App",
                })}
          </DialogTitle>
          <DialogDescription className="mt-2">
            {selecting
              ? t(
                  stableTarget.kind === "chat"
                    ? "apps.authorization.selectDescriptionChat"
                    : "apps.authorization.selectDescriptionProject"
                )
              : t("apps.authorization.settingsDescription")}
          </DialogDescription>
          {mode === "add" && (
            <>
              {/* 「第 1 步，共 2 步」只报数：它不说这两步分别要做什么，也没有
                  任何进度形状。两段轨各带一个名字，同时回答「现在在哪」与
                  「接下来做什么」；那句报数留给读屏，视觉上不再占一行。 */}
              <p aria-live="polite" className="sr-only">
                {t("apps.authorization.step", {
                  current: selecting ? 1 : 2,
                  total: 2,
                })}
              </p>
              <div aria-hidden className="mt-3.5 flex items-center gap-2.5">
                {[
                  { label: t("apps.authorization.stepSelect"), done: true, here: selecting },
                  { label: t("apps.authorization.stepAuthorize"), done: !selecting, here: !selecting },
                ].map((entry) => (
                  <span className="flex flex-1 flex-col gap-1.5" key={entry.label}>
                    <span
                      className={cn(
                        "h-[3px] rounded-full",
                        entry.done ? "bg-foreground" : "bg-border"
                      )}
                    />
                    <span
                      className={cn(
                        "text-[11px] leading-[14px]",
                        entry.here
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {entry.label}
                    </span>
                  </span>
                ))}
              </div>
            </>
          )}
        </DialogHeader>

        <AppDialogBody className="mt-4">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground text-sm" role="status">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              {t("apps.authorization.loading")}
            </div>
          ) : selecting ? (
            <div className="space-y-2" role="radiogroup" aria-label={t("apps.authorization.installedApps")}>
              {candidates.map((candidate) => {
                const reason = unavailableReason(candidate);
                const scopeDisabled = Boolean(
                  candidate.scopeRecord &&
                    !isPositiveAppGrant(candidate.scopeRecord)
                );
                /* 能选的项无话可说就不说：一行空的副标题不是留白，是内容
                   缺席。只有「用不了」和「之前被停用」才需要一句解释。 */
                const note = reason || (scopeDisabled ? t("apps.authorization.disabledHere") : "");
                return (
                  <button
                    aria-checked={selectedId === candidate.appId}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                      selectedId === candidate.appId && "border-foreground bg-muted",
                      reason
                        ? "cursor-not-allowed opacity-55"
                        : "cursor-pointer hover:bg-muted/70"
                    )}
                    disabled={Boolean(reason)}
                    key={candidate.appId}
                    onClick={() => choose(candidate)}
                    onKeyDown={(event) => moveCandidateFocus(event)}
                    role="radio"
                    tabIndex={
                      selectedId === candidate.appId ||
                      (!selectedId && firstSelectableId === candidate.appId)
                        ? 0
                        : -1
                    }
                    type="button"
                  >
                    {/* 图标取 manifest 自己的那一枚：同一个 App 在 Apps 页、
                        Project 设置与这里必须长同一张脸。 */}
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-xl leading-none">
                      {candidate.icon ?? "📦"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-sm">
                        {candidate.name}
                      </span>
                      {note && (
                        <span className="mt-0.5 block text-muted-foreground text-xs">
                          {note}
                        </span>
                      )}
                    </span>
                    {selectedId === candidate.appId && !reason && (
                      <Check className="size-4 shrink-0" aria-hidden />
                    )}
                  </button>
                );
              })}
              {!candidates.length && (
                <p className="py-10 text-center text-muted-foreground text-sm">
                  {t("apps.authorization.noInstalledApps")}
                </p>
              )}
            </div>
          ) : selected ? (
            <div className="space-y-5">
              {stableTarget.kind === "chat" && selected.inheritedGrant && (
                <div role="radiogroup" aria-label={t("apps.authorization.authorizationMode")}>
                  <SettingsChoiceRow
                    checked={authorizationMode === "inherited"}
                    description={t("apps.authorization.useInheritedDescription", {
                      source: sourceLabel(selected.inheritedSource, t),
                    })}
                    disabled={busy}
                    label={t("apps.authorization.useInherited")}
                    onSelect={() => setAuthorizationMode("inherited")}
                  />
                  <SettingsChoiceRow
                    checked={authorizationMode === "custom"}
                    description={t("apps.authorization.customDescription")}
                    disabled={busy}
                    label={t("apps.authorization.customForChat")}
                    onSelect={() => setAuthorizationMode("custom")}
                  />
                </div>
              )}

              {authorizationMode === "custom" && (
                <>
                  {hasData && (
                    <section>
                      <h3 className="font-medium text-sm">
                        {t("apps.authorization.dataAccess")}
                      </h3>
                      <p className="mt-1 text-muted-foreground text-xs">
                        {t("apps.authorization.dataAccessDescription", {
                          name: selected.name,
                        })}
                      </p>
                      <div className="mt-2" role="radiogroup" aria-label={t("apps.authorization.dataAccess")}>
                        {APP_DATA_LEVELS.map((level) => (
                          <SettingsChoiceRow
                            checked={dataLevel === level}
                            description={t(APP_DATA_LEVEL_DETAIL_KEYS[level])}
                            disabled={busy}
                            key={level}
                            label={t(APP_DATA_LEVEL_KEYS[level])}
                            labelMeta={
                              inheritedLevel === level ? (
                                <SettingsBadge tone="muted">
                                  {t("apps.authorization.inheritedBadge", {
                                    source: sourceLabel(selected.inheritedSource, t),
                                  })}
                                </SettingsBadge>
                              ) : undefined
                            }
                            onSelect={() => setDataLevel(level)}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="flex items-start gap-4 border-t pt-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-sm">
                        {t("apps.authorization.agentDelegation")}
                      </h3>
                      {/* 没有数据表的 App 根本不显示上面那一节，说明里
                          再提「上面的数据档位」就是指着一片空白说话。 */}
                      <p className="mt-1 text-muted-foreground text-xs">
                        {t(
                          hasData
                            ? "apps.authorization.agentDelegationDescription"
                            : "apps.authorization.agentDelegationDescriptionNoData"
                        )}
                      </p>
                    </div>
                    <SettingsSwitch
                      checked={delegated}
                      disabled={busy}
                      id={`app-authorization-delegation-${selected.appId}`}
                      label={t("apps.authorization.agentDelegation")}
                      onToggle={setDelegated}
                    />
                  </section>

                  {/* 两个枚举合成一句人话。这是整屏唯一让人在签字前看得懂
                      自己签了什么的地方，所以它紧贴页脚，随选择实时改写。
                      只有一个开关时不出现：那句开关说明已经把两端都讲清了，
                      再总结一遍就是纯粹的重复。 */}
                  {hasData && (
                    <section className="rounded-lg bg-sunken p-3">
                      <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                        {t(
                          mode === "add"
                            ? "apps.authorization.summaryTitle"
                            : "apps.authorization.summaryTitleSaved"
                        )}
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed">
                        {`${t(APP_DATA_LEVEL_OUTCOME_KEYS[dataLevel], { name: selected.name })} ${t(
                          delegated
                            ? dataLevel === "none"
                              ? "apps.authorization.outcomeAgentOnNoData"
                              : "apps.authorization.outcomeAgentOn"
                            : "apps.authorization.outcomeAgentOff"
                        )}`}
                      </p>
                    </section>
                  )}
                </>
              )}

              {mode === "edit" && (
                <section className="flex flex-wrap gap-2 border-t pt-4">
                  {selected.scopeRecord && (
                    <Button
                      disabled={busy}
                      onClick={() => void setScopeState("clear")}
                      size="sm"
                      variant="outline"
                    >
                      {stableTarget.kind === "chat"
                        ? t("apps.authorization.restoreInheritance")
                        : t("apps.authorization.restoreGlobal")}
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    onClick={() => void setScopeState("disabled")}
                    size="sm"
                    variant="destructive"
                  >
                    {stableTarget.kind === "chat"
                      ? t("apps.authorization.removeFromChat")
                      : t("apps.authorization.removeFromProject")}
                  </Button>
                </section>
              )}
            </div>
          ) : (
            <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground text-sm" role="alert">
              <AlertTriangle className="size-4" />
              {t("apps.authorization.appUnavailable")}
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </AppDialogBody>

        {/* 出口收成两个。从前页脚的「取消」与右上角的 × 是同一件事说两遍，
            而它与「返回」视觉重量接近、后果却差着一个量级。× 与 Esc 一样
            走 close()，busy 时同样关不掉，所以删掉它不放松任何围栏。 */}
        <DialogFooter className="mt-5 shrink-0 flex-row justify-between gap-3">
          <div>
            {mode === "add" && !selecting && !savedAppId && (
              <Button
                disabled={busy}
                onClick={() => setStep("select")}
                variant="ghost"
              >
                <ArrowLeft />
                {t("apps.authorization.back")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {selecting ? (
              <Button
                disabled={!selectedId || busy}
                onClick={() => setStep("authorize")}
              >
                {t("apps.authorization.next")}
              </Button>
            ) : savedAppId ? (
              <Button disabled={busy} onClick={() => void retryFinish()}>
                {t("apps.authorization.retryRefresh")}
              </Button>
            ) : (
              <Button disabled={!selected || busy} onClick={() => void save()}>
                {busy
                  ? t("apps.authorization.saving")
                  : mode === "add"
                    ? t(
                        stableTarget.kind === "chat"
                          ? "apps.authorization.addToChat"
                          : "apps.authorization.addToProject"
                      )
                    : t("apps.authorization.save")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}

function dialogSessionKey(
  input: Omit<AppAuthorizationDialogProps, "open">
) {
  const target = input.target;
  const fence = target.kind === "chat"
    ? `${target.chatId}:${target.expectedConversationIncarnationId}`
    : `${target.projectId}:${target.expectedProjectLifecycleRevision}`;
  return `${input.mode}:${input.appId ?? "new"}:${target.kind}:${fence}`;
}

function authorizationDraft(
  candidate: AppGrantCandidate,
  targetKind: AppGrantCommandTarget["kind"]
): Readonly<{
  mode: AuthorizationMode;
  dataLevel: AppDataLevel;
  delegated: boolean;
}> {
  const localGrant =
    candidate.scopeRecord && isPositiveAppGrant(candidate.scopeRecord)
      ? candidate.scopeRecord
      : null;
  const grant = localGrant ?? candidate.inheritedGrant;
  return {
    mode:
      targetKind === "chat" && !localGrant && candidate.inheritedGrant
        ? "inherited"
        : "custom",
    dataLevel: grant?.data?.level ?? "none",
    delegated: hasDelegation(grant),
  };
}

function hasDelegation(grant: AppCapabilityGrant | null) {
  return Boolean(grant?.agentDelegation.fileRead || grant?.agentDelegation.useData);
}

function sourceLabel(
  source: AppGrantCandidate["inheritedSource"],
  t: (key: string, values?: Record<string, unknown>) => string
) {
  return t(
    source === "project"
      ? "apps.authorization.sourceProject"
      : "apps.authorization.sourceGlobal"
  );
}

function moveCandidateFocus(event: KeyboardEvent<HTMLButtonElement>) {
  const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
  const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
  if (!forward && !backward) return;
  event.preventDefault();
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const options = [
    ...(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? []),
  ];
  const index = options.indexOf(event.currentTarget);
  if (index < 0 || options.length === 0) return;
  const next = options[
    (index + (forward ? 1 : options.length - 1)) % options.length
  ];
  next?.focus();
  next?.click();
}
