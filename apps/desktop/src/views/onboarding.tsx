/**
 * [INPUT]: Depends on React, react-router navigation, useAppTranslation onboarding catalog, SetupProvider judgments, Library-first Skills discovery/import, settingsStore, brand assets, SetupBackendRow and Settings/UI primitives
 * [OUTPUT]: Provides the required Chat Home/Agent onboarding followed by optional Skills discovery and Memory setup
 * [POS]: Insensible main-owned onboarding pages of views; The sequence of steps and blockages are all derived from the same judgment as the onboarding-gate, and the page itself is no longer a threshold
 */

import { ChevronLeft, Check, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { SetupBackendRow } from "@/components/setup/backend-row";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  PRODUCT_LOGO_SIZE,
  PRODUCT_LOGO_URLS,
  PRODUCT_MARK_SIZE,
  PRODUCT_MARK_URL,
  PRODUCT_NAME,
} from "@/lib/brand";
import { MEMORY_SETTINGS_PATH } from "@/lib/settings-navigation";
import { hasSettingsBridge } from "@/lib/settings-client";
import { isApplePlatform } from "@/lib/platform";
import { settingsStore } from "@/lib/settings-store";
import {
  importAllDiscoveredSkills,
  listUnifiedSkillCandidates,
  listUnifiedSkills,
} from "@/lib/unified-skills-client";
import { ONBOARDING_REQUIREMENTS } from "@/lib/onboarding-gate";
import { AGENT_BACKEND_ORDER } from "../../shared/agent-ipc";

/* ============================================================
 * 步骤表由门槛清单长出来，不是另抄一份。
 *
 * 前两步就是 ONBOARDING_REQUIREMENTS 本身——顺序、阻塞判据、i18n 取键
 * 全部同源；记忆缀在末尾，它永远不进 missing，也就永远不拦人。新增一条
 * 门槛只改 onboarding-gate，这里自动多一页。
 * ============================================================ */
const WIZARD_STEPS = [...ONBOARDING_REQUIREMENTS, "skills", "memory"] as const;
type WizardStepId = (typeof WIZARD_STEPS)[number];

/** 记忆是可选的，故只有前两步会拦住「继续」。 */
const isRequired = (id: WizardStepId): id is "chat-home" | "agent" =>
  id === "chat-home" || id === "agent";

/* ============================================================
 * 左侧品牌栏：近黑暖调，不随主题变。
 *
 * 它不是应用表面而是产品门面，深色是这一屏的身份而非当前主题的投影，
 * 故这里写死色值、并且始终取深色横向标识——若跟着 --sidebar 走，
 * 浅色主题下这面板会变成一块白，竖向 stepper 的白字当场消失。
 * ============================================================ */
const INK = "oklch(0.185 0.004 88)";

function StepMark({
  index,
  state,
}: {
  index: number;
  state: "done" | "current" | "todo";
}) {
  if (state === "done") {
    return (
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-emerald-400 ring-1 ring-emerald-400/45 ring-inset"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full font-medium text-[13px]",
        state === "current"
          ? "bg-white text-[oklch(0.185_0.004_88)]"
          : "text-white/50 ring-1 ring-white/20 ring-inset"
      )}
    >
      {index}
    </span>
  );
}

function BrandRail({ cursor }: { cursor: number }) {
  const { t } = useAppTranslation();
  return (
    <aside
      className="relative flex w-[552px] shrink-0 flex-col overflow-hidden px-12 pt-[78px] pb-11"
      style={{ background: INK }}
    >
      {/* 单图形放大到 624px、透明度 3.5%：只做质感，不做图形——
          再亮一点它就成了第二枚标识，跟顶部的字标抢读序。 */}
      <img
        aria-hidden="true"
        alt=""
        className="pointer-events-none absolute -bottom-[256px] -left-[244px] size-[624px] select-none opacity-[0.035]"
        draggable={false}
        height={PRODUCT_MARK_SIZE.height}
        src={PRODUCT_MARK_URL}
        width={PRODUCT_MARK_SIZE.width}
      />
      {/* align-self + object-position 一起写：列向 flex 默认 stretch，
          少了这两条，图会被拉成整列宽再由 object-fit 居中，于是标识与
          下面 stepper 的左缘永远对不上。 */}
      <img
        alt={PRODUCT_NAME}
        className="pointer-events-none relative h-[46px] w-auto shrink-0 select-none self-start object-contain object-left"
        draggable={false}
        height={PRODUCT_LOGO_SIZE.height}
        src={PRODUCT_LOGO_URLS.dark}
        width={PRODUCT_LOGO_SIZE.width}
      />
      <ol className="relative mt-[68px] flex flex-col gap-1.5">
        {WIZARD_STEPS.map((id, index) => {
          const state =
            index < cursor ? "done" : index === cursor ? "current" : "todo";
          return (
            <li key={id}>
              {index > 0 && (
                <div aria-hidden="true" className="flex w-7 justify-center py-1">
                  <span
                    className={cn(
                      "h-[22px] w-px",
                      index <= cursor ? "bg-white/30" : "bg-white/15"
                    )}
                  />
                </div>
              )}
              <div
                aria-current={state === "current" ? "step" : undefined}
                className="flex items-start gap-3.5"
              >
                <StepMark index={index + 1} state={state} />
                <div className="min-w-0 pt-1">
                  <p
                    className={cn(
                      "font-medium text-sm",
                      state === "current"
                        ? "text-white"
                        : state === "done"
                          ? "text-white/70"
                          : "text-white/50"
                    )}
                  >
                    {t(`onboarding.step.${id}`)}
                    {(id === "skills" || id === "memory") && (
                      <span className="ml-2 rounded-sm bg-white/10 px-1.5 py-px font-medium text-[11px] text-white/60">
                        {t("onboarding.optional")}
                      </span>
                    )}
                    {/* 圆点是 aria-hidden 的纯视觉进度，完成与否只能由这里说给读屏听。 */}
                    <span className="sr-only">
                      {t(
                        state === "done"
                          ? "onboarding.stepDone"
                          : "onboarding.stepTodo"
                      )}
                    </span>
                  </p>
                  <p
                    className={cn(
                      "mt-[3px] text-[11px]",
                      state === "current" ? "text-white/60" : "text-white/30"
                    )}
                  >
                    {t(`onboarding.blurb.${id}`)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function StepHeading({ id, optional }: { id: WizardStepId; optional?: boolean }) {
  const { t } = useAppTranslation();
  return (
    <div className="flex flex-col gap-2.5">
      <h1 className="font-semibold text-[30px]/[38px] tracking-[-0.025em]">
        {t(`onboarding.heading.${id}`, { product: PRODUCT_NAME })}
        {optional && (
          <span className="ml-2.5 rounded-sm bg-muted px-1.5 py-0.5 align-middle font-medium text-[11px] text-muted-foreground">
            {t("onboarding.optional")}
          </span>
        )}
      </h1>
      <p className="max-w-[32rem] text-muted-foreground text-sm/[22px]">
        {t(`onboarding.description.${id}`)}
      </p>
    </div>
  );
}

const surface =
  "rounded-lg bg-card shadow-sm ring-1 ring-foreground/10";

function ChatHomeStep() {
  const { t } = useAppTranslation();
  const { settings, error, chatHomesRootBusy, chatHomesRootError } =
    useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const state = settings?.chatHomeState ?? "unconfigured";
  const chosen = Boolean(settings?.chatHomesRoot);

  return (
    <>
      <StepHeading id="chat-home" />
      <div className={cn(surface, "flex items-center gap-3.5 p-5")}>
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-sunken text-muted-foreground">
          <FolderOpen className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          {settings ? (
            /* 路径的身份在尾段：truncate 会先吃掉 `…/chat-homes`，
               恰好抹掉用户唯一认得出的部分。宁可折两行也要留全。 */
            <p
              className="line-clamp-2 break-all font-mono text-sm"
              title={settings.chatHomesRoot ?? undefined}
            >
              {settings.chatHomesRoot ?? (
                <span className="font-medium font-sans">
                  {t("onboarding.chatHomeUnset")}
                </span>
              )}
            </p>
          ) : (
            <Skeleton className="h-3.5 w-64 max-w-full" />
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t(`onboarding.chatHome.${state}`)}
          </p>
        </div>
        {error ? (
          <Button size="lg" variant="outline" onClick={settingsStore.retrySettings}>
            {t("common.retry")}
          </Button>
        ) : (
          /* 未选定时它是这一屏唯一能解锁流程的动作，故是实心主按钮；
             选定之后降级为 outline，让「继续」重新成为唯一的主行动。 */
          <Button
            size="lg"
            variant={chosen ? "outline" : "default"}
            disabled={chatHomesRootBusy || !settings || !hasSettingsBridge()}
            onClick={() => void settingsStore.chooseChatHomesRoot()}
          >
            {chatHomesRootBusy && <Spinner className="size-3.5" />}
            {t(chosen ? "onboarding.change" : "onboarding.choose")}
          </Button>
        )}
      </div>
      {(error || chatHomesRootError) && (
        <p role="alert" className="text-destructive text-xs">
          {chatHomesRootError || error}
        </p>
      )}
    </>
  );
}

function BackendRowSkeleton() {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <Skeleton className="size-4 shrink-0 rounded" />
      <Skeleton className="h-3 w-16 shrink-0" />
      <Skeleton className="h-2.5 w-14" />
      <Skeleton className="ml-auto h-4 w-14 shrink-0 rounded-full" />
    </div>
  );
}

function AgentStep() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const anyActionable = setup.status?.backends.some(
    (backend) => backend.status !== "ready"
  );
  return (
    <>
      <StepHeading id="agent" />
      <div className={cn(surface, "divide-y divide-border overflow-hidden")}>
        {setup.status
          ? setup.status.backends.map((backend) => (
              <SetupBackendRow key={backend.id} backend={backend} />
            ))
          : AGENT_BACKEND_ORDER.map((id) => <BackendRowSkeleton key={id} />)}
      </div>
      {/* 「我已登录，重新检测」那颗按钮撤掉了，取而代之的是这句话：
         去终端登录完回到窗口就会自动复检，用户不必再找一个按钮按。 */}
      <p className="text-[11px] text-muted-foreground">
        {anyActionable && `${t("onboarding.agentActionHint")} `}
        {t("onboarding.agentAutoRecheck", { product: PRODUCT_NAME })}
      </p>
      {setup.error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs ring-1 ring-destructive/20"
        >
          {setup.error}
        </p>
      )}
    </>
  );
}

function SkillsStep() {
  const { t } = useAppTranslation();
  const { settings, error: settingsError } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const [count, setCount] = useState(0);
  const [libraryEmpty, setLibraryEmpty] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void Promise.all([listUnifiedSkills(), listUnifiedSkillCandidates("all", false)])
      .then(([snapshot, preview]) => {
        if (!live) return;
        setLibraryEmpty(snapshot.personalLibraryEmpty);
        setCount(preview.candidates.filter(
          (candidate) => candidate.importable && candidate.status !== "current"
        ).length);
      })
      .catch((cause) => live && setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, []);

  const imported = settings?.skillsOnboarding === "done" || !libraryEmpty;
  const importAll = async () => {
    setBusy(true);
    setError("");
    try {
      const snapshot = await importAllDiscoveredSkills();
      setLibraryEmpty(snapshot.personalLibraryEmpty);
      await settingsStore.update(
        { skillsOnboarding: "done" },
        t("onboarding.skillsUpdateFailed")
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const skip = () => settingsStore.update(
    { skillsOnboarding: "skipped" },
    t("onboarding.skillsUpdateFailed")
  );

  return (
    <>
      <StepHeading id="skills" optional />
      <div className={cn(surface, "flex items-center gap-4 p-5")}>
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-sunken text-lg">
          $
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">
            {busy
              ? t("onboarding.skillsScanning")
              : imported
                ? t("onboarding.skillsDone")
                : t("onboarding.skillsFound", { count })}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("onboarding.skillsHint")}
          </p>
        </div>
        {!imported && count > 0 && (
          <Button disabled={busy} onClick={() => void importAll()} size="lg">
            {busy && <Spinner className="size-3.5" />}
            {t("onboarding.skillsImportAll")}
          </Button>
        )}
        {!imported && settings?.skillsOnboarding === "pending" && (
          <Button disabled={busy} onClick={() => void skip()} size="lg" variant="ghost">
            {t("onboarding.skillsSkip")}
          </Button>
        )}
      </div>
      {(error || settingsError) && (
        <p role="alert" className="text-destructive text-xs">{error || settingsError}</p>
      )}
    </>
  );
}

function MemoryStep({ onLeave }: { onLeave: () => void }) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const enabled = Boolean(settings?.memory.enabled);
  return (
    <>
      <StepHeading id="memory" optional />
      <div className={cn(surface, "flex items-center gap-3.5 p-5")}>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">
            {t(enabled ? "onboarding.memoryOn" : "onboarding.memoryOff")}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t(
              enabled ? "onboarding.memoryEnabled" : "onboarding.memoryDisabled"
            )}
          </p>
        </div>
        <Button
          size="lg"
          variant="outline"
          onClick={() => {
            onLeave();
            void navigate(MEMORY_SETTINGS_PATH);
          }}
        >
          {t("onboarding.memoryAction")}
        </Button>
      </div>
      {/* 这一步没有单独的「跳过」：主按钮就是跳过。多一颗 Skip 只会和它抢。 */}
      <p className="text-[11px] text-muted-foreground">
        {t("onboarding.memorySkip")}
      </p>
    </>
  );
}

export function OnboardingView() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const [cursor, setCursor] = useState(0);
  const { facts, settled } = setup.onboarding;
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );

  /* 落定后把光标停在第一个未满足的必做步：Agent 通常首启就已就绪，
     从头走一遍只是空转。只做一次——之后光标归用户，补齐某一步不该
     把正在看的页面抽走。

     渲染期就地调整而非 effect 回写，与 SetupProvider 的守档同一个理由：
     effect 回写要多渲染一帧，那一帧显示的是还没落位的光标；布尔守卫
     保证至多多渲染一次即收敛。 */
  const [seeded, setSeeded] = useState(false);
  if (settled && !seeded) {
    setSeeded(true);
    const first = WIZARD_STEPS.findIndex(
      (id) => isRequired(id) && facts[id] !== "satisfied"
    );
    if (first > 0) setCursor(first);
  }

  /* 去终端登录完回到窗口即自动复检——这是撤掉手动复检按钮的前提条件，
     不是附赠品。只在引导期挂：全应用每次 focus 都探一遍四家 CLI 太贵。 */
  const setupRef = useRef(setup);
  useEffect(() => {
    setupRef.current = setup;
  });
  useEffect(() => {
    const onFocus = () => {
      const current = setupRef.current;
      if (!current.checking) void current.recheck();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const step = WIZARD_STEPS[cursor];
  const last = cursor === WIZARD_STEPS.length - 1;
  const blocked = isRequired(step) && facts[step] !== "satisfied";
  const advance = async () => {
    if (step === "skills" && settings?.skillsOnboarding === "pending") {
      await settingsStore.update(
        { skillsOnboarding: "skipped" },
        t("onboarding.skillsUpdateFailed")
      );
    }
    setCursor((value) => value + 1);
  };

  return (
    <TooltipProvider>
      <div className="relative flex h-svh overflow-hidden bg-background">
        {/* 无边框窗口（macOS）的拖拽区：横跨整个窗口顶部，两栏内容都从 40px 以下开始。
            Windows 走系统原生标题栏，拖拽与顶部留白都归 OS，故这条与右栏的 40px 占位一起按平台隐去。 */}
        {isApplePlatform() && (
          <div className="absolute inset-x-0 top-0 h-10 [-webkit-app-region:drag]" />
        )}
        <BrandRail cursor={cursor} />
        <section className="flex min-w-0 flex-1 flex-col">
          {isApplePlatform() && <div className="h-10 shrink-0" />}
          <SlimScroller className="flex min-h-0 flex-1 flex-col overflow-y-auto px-16 pb-6">
            <div className="my-auto flex w-full flex-col gap-6">
              {step === "chat-home" && <ChatHomeStep />}
              {step === "agent" && <AgentStep />}
              {step === "skills" && <SkillsStep />}
              {step === "memory" && (
                <MemoryStep onLeave={setup.leaveOnboarding} />
              )}
            </div>
          </SlimScroller>
          {/* 动作条固定在右栏底部：位置永不随内容跳，三页共用同一条几何。
              没有逃生门——两个门槛没补齐就是进不去。 */}
          <div className="flex h-[76px] shrink-0 items-center gap-4 border-t px-16">
            {/* 第一步无处可退，就不画 Back——一颗禁用态的占位按钮看着像坏了。 */}
            {cursor > 0 && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setCursor((value) => value - 1)}
              >
                <ChevronLeft />
                {t("onboarding.back")}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-4">
              {/* 只有 Agent 步给一行原因：它的门槛是「至少登录一个」，四行各自
                  的 Install/Sign in 按钮说不出这个阈值。数据位置步只有一件事
                  可做，卡里就有一颗醒目的主按钮，再补一句「去选目录」是废话。 */}
              {blocked && step === "agent" && (
                <p className="flex items-center gap-1.5 text-xs">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-amber-500"
                  />
                  {t("onboarding.blocked.agent")}
                </p>
              )}
              <Button
                size="lg"
                className="px-5"
                disabled={blocked}
                onClick={
                  last
                    ? setup.leaveOnboarding
                    : () => void advance()
                }
              >
                {t(last ? "onboarding.start" : "onboarding.next")}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
