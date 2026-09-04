"use client";

/**
 * [INPUT]: Depends on AppsProvider preset facts, typed preset identities, Apps i18n, AppInstallReadme/AppInstallGrants, SlimScroller, requirements form, and AppDialog surfaces
 * [OUTPUT]: Provides locale-projected PresetShelf/PresetCard copy plus a direct install affordance and three-step authorization/install dialog (one mount = one probe) whose README scrolls inside a bounded zone while the grant card stays pinned above the footer
 * [POS]: Apps first-party discovery shelf; IPC carries stable identity and install facts while this renderer boundary owns all five-language product copy
 */

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Card, CardDescription, CardHeader, CardTitle } from "@ai-chat/ui/components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
import type {
  AppConfigValue,
  AppRecord,
  InstallPresetInput,
  PresetAppId,
  PresetAppSummary,
  PresetProbeResult,
} from "../../../../shared/apps-ipc";
import { AppRequirementsForm, appRequirementsSatisfied } from "./app-requirements-form";
import {
  AppInstallGrants,
  AppInstallReadme,
  hasInstallReadme,
} from "./app-install-disclosure";

const EMPTY_CONFIG: AppConfigValue = { values: {}, agentReadableKeys: [] };
type CardStage =
  | { kind: "idle" }
  | { kind: "probing" }
  | { kind: "ready"; probe: PresetProbeResult }
  | { kind: "installing"; probe: PresetProbeResult };

const PRESET_COPY_KEYS = {
  "design-canvas": {
    nameKey: "apps.presets.designCanvas.name",
    descriptionKey: "apps.presets.designCanvas.description",
  },
  "dev-kanban": {
    nameKey: "apps.presets.devKanban.name",
    descriptionKey: "apps.presets.devKanban.description",
  },
  "expense-tracker": {
    nameKey: "apps.presets.expenseTracker.name",
    descriptionKey: "apps.presets.expenseTracker.description",
  },
  "fitness-log": {
    nameKey: "apps.presets.fitnessLog.name",
    descriptionKey: "apps.presets.fitnessLog.description",
  },
} as const satisfies Record<
  PresetAppId,
  { nameKey: string; descriptionKey: string }
>;

function localizedPreset(
  t: ReturnType<typeof useAppTranslation>["t"],
  presetId: PresetAppId
) {
  const copy = PRESET_COPY_KEYS[presetId];
  return { name: t(copy.nameKey), description: t(copy.descriptionKey) };
}

function pickReadme(zh: boolean, probe: PresetProbeResult) {
  const disclosed = (path: string) => probe.disclosures.find((entry) => entry.path === path)?.content;
  return (zh ? disclosed("README.zh-CN.md") : disclosed("README.md")) ?? disclosed("README.md") ?? "";
}

/* ------------------------------------------------------------------------- *
 *  货架只在「一张 App 都没有」时出现：它是开局的第一步，不是常驻陈列。
 *  装完第一份之后，首方 App 的入口移交页头 + 菜单，页面重新只讲已安装的事。
 * ------------------------------------------------------------------------- */
export function PresetShelf({ onSelect }: { onSelect: (preset: PresetAppSummary) => void }) {
  const { presets } = useApps();
  if (presets.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
      {presets.map((preset) => (
        <PresetCard key={preset.id} onOpen={() => onSelect(preset)} preset={preset} />
      ))}
    </div>
  );
}

/* 卡片不再显示已装份数：货架只在零 App 时出现，那一刻份数恒为零——
   一个永远走不到的分支比一个写错的分支更难发现，故连同份数一起删掉。 */
export function PresetCard({ preset, onOpen }: {
  preset: PresetAppSummary;
  onOpen: () => void;
}) {
  const { t } = useAppTranslation();
  const copy = localizedPreset(t, preset.id);

  return (
    <Card
      /* 可及名必须含住看得见的那颗动作文案（WCAG 2.5.3）：卡面写的是
         「安装」，键名从前却还叫 openDetails——名字与它指的事早已分家。 */
      aria-label={t("apps.presetInstallNamed", { name: copy.name })}
      className="group h-full cursor-pointer transition-colors hover:bg-muted/30"
      data-preset-id={preset.id}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        /* 空格在可滚动祖先上默认翻页：一个扮成按钮的卡片必须自己拦下它，
           否则键盘用户按一次「安装」，页面顺手滚走一屏。 */
        if (event.key === " ") event.preventDefault();
        onOpen();
      }}
      role="button"
      tabIndex={0}
    >
      <CardHeader>
        <span className="mb-2 text-4xl">{preset.icon}</span>
        <CardTitle className="truncate text-base">{copy.name}</CardTitle>
        <CardDescription className="line-clamp-2">{copy.description}</CardDescription>
        {preset.id === "design-canvas" && (
          <p className="line-clamp-2 text-muted-foreground text-xs">
            {t("apps.designPresetReinstallHint")}
          </p>
        )}
      </CardHeader>
      <div className="px-4 pb-4">
        <p className="flex items-center gap-1.5 font-medium text-sm text-primary" data-testid="preset-details-label"><Download className="size-4" />{t("apps.presetInstall")}</p>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------- *
 *  安装详情：probe → ready → install 三段协议的唯一现场。
 *  「再看一次」由调用方换 key 表达（一次挂载 = 一次 probe），组件内因此不必
 *  再数 attempt——epoch 交给谁掌管，谁就该持有它，两处各存一份必然对不齐。
 * ------------------------------------------------------------------------- */
export function PresetInstallDialog({ preset, open, onOpenChange, probePreset, discardPresetProbe, onInstall }: {
  preset: PresetAppSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  probePreset: (presetId: string) => Promise<PresetProbeResult>;
  discardPresetProbe: (preflightId: string) => Promise<void>;
  onInstall: (input: InstallPresetInput) => Promise<AppRecord>;
}) {
  const { t, i18n } = useAppTranslation();
  const zh = (i18n.language ?? "").toLowerCase().startsWith("zh");
  const copy = localizedPreset(t, preset.id);
  const [config, setConfig] = useState<AppConfigValue>(EMPTY_CONFIG);
  const [stage, setStage] = useState<CardStage>({ kind: "probing" });
  const [error, setError] = useState("");
  /* ── 为什么这里是世代号而不是一个布尔 ──────────────────────────────
   * 「本次挂载还是不是 preflight 的主人」用布尔表达，前提是「一次挂载 = 一次
   * effect」。StrictMode 下这个前提不成立：dev 会 挂载→清理→再挂载 跑两遍，
   * 清理把布尔置 false 之后没有任何东西再把它置回来，于是第二次 probe 的结果
   * 被当成迟到件丢弃、stage 永远停在 probing——弹窗转圈到天荒地老，而生产构建
   * 里 StrictMode 是空操作，一测就过。
   * 世代号没有这个盲区：每次 effect 认领一个新号，只有号还对得上的结果才收，
   * 对不上的一律归还。关窗同样只是让号往前走一格。
   * ──────────────────────────────────────────────────────────────── */
  const generation = useRef(0);
  const heldPreflight = useRef<string | null>(null);
  const ready = appRequirementsSatisfied(preset.requirements, config);

  const release = () => {
    const preflightId = heldPreflight.current;
    heldPreflight.current = null;
    if (preflightId) void discardPresetProbe(preflightId).catch(() => undefined);
  };

  const retryProbe = async () => {
    const mine = (generation.current += 1);
    release();
    setStage({ kind: "probing" });
    setError("");
    try {
      const next = await probePreset(preset.id);
      if (mine !== generation.current) {
        await discardPresetProbe(next.preflightId).catch(() => undefined);
        return;
      }
      heldPreflight.current = next.preflightId;
      setStage({ kind: "ready", probe: next });
    } catch (cause) {
      if (mine !== generation.current) return;
      setStage({ kind: "idle" });
      setError(errorMessage(cause, t("apps.presetProbeFailed")));
    }
  };

  useEffect(() => {
    const mine = (generation.current += 1);
    void (async () => {
      try {
        const probe = await probePreset(preset.id);
        if (mine !== generation.current) {
          await discardPresetProbe(probe.preflightId).catch(() => undefined);
          return;
        }
        heldPreflight.current = probe.preflightId;
        setStage({ kind: "ready", probe });
      } catch (cause) {
        if (mine !== generation.current) return;
        setStage({ kind: "idle" });
        setError(errorMessage(cause, t("apps.presetProbeFailed")));
      }
    })();
    return () => {
      generation.current += 1;
      release();
    };
    /* 刻意只跑一次：probePreset 每次渲染都是新函数，追依赖等于每渲染重探一遍。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    /* 安装结果必须回到用户刚确认的现场；进行中不允许 Escape/× 把状态藏掉。 */
    if (stage.kind === "installing") return;
    generation.current += 1;
    release();
    onOpenChange(false);
  };

  /* 成功才关窗：抢先关掉，失败就没有人接住那句错误——弹窗是用户点下确认的
     地方，也该是他得知结果的地方。成功后不回 idle，让内容维持到退场动画结束。 */
  const confirmInstall = async () => {
    if (stage.kind !== "ready" || !ready) return;
    const probe = stage.probe;
    heldPreflight.current = null;
    setStage({ kind: "installing", probe });
    setError("");
    try {
      await onInstall({
        presetId: preset.id,
        requestId: crypto.randomUUID(),
        preflightId: probe.preflightId,
        digest: probe.digest,
        authorization: {
          scope: "studio-only",
          decision: "approve-requested",
        },
        ...(preset.requirements.length ? { config } : {}),
      });
      setConfig(EMPTY_CONFIG);
      onOpenChange(false);
    } catch (cause) {
      /* preflight 已随提交转移给 main，renderer 不得重放；只能重开取新的一份。 */
      setStage({ kind: "idle" });
      setError(errorMessage(cause, t("apps.presetInstallFailed")));
    }
  };

  const probe = stage.kind === "ready" || stage.kind === "installing" ? stage.probe : null;
  const readme = probe ? pickReadme(zh, probe) : "";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <AppDialogContent className="sm:max-w-[36rem]" data-testid="preset-detail">
        {/* 图标离开标题：标题只留名字，可访问名不再夹着一个读不出来的字符，
            而那颗 emoji 单独成块反倒比塞在句首更像它自己。pr 给右上角的 × 让位。 */}
        {/* 正文是唯一会滚的层，头尾各留一条满幅细线：没有它，长 README 会从
            标题背后穿过去、又贴着按钮收尾，看起来像被裁掉而不是还没滚完。
            -mx-5 是把 AppDialogContent 的内边距抵消掉——细线要横贯整个表面，
            缩在正文列里那条线就成了装饰而非边界。 */}
        <DialogHeader className="-mx-5 shrink-0 gap-0 border-b px-5 pr-8 pb-4 text-left">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-2xl">{preset.icon}</span>
            <div className="min-w-0">
              <DialogTitle className="text-lg/6 font-semibold">
                {t("apps.installAuthorizationTitle", { name: copy.name })}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm/5">
                {t("apps.installAuthorizationDescription")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {stage.kind === "probing" ? (
          <AppDialogBody className="-mx-5 px-5 py-5">
            <div className="grid min-h-48 place-items-center" role="status"><Spinner className="size-5" /><span className="sr-only">{t("apps.presetProbing")}</span></div>
          </AppDialogBody>
        ) : probe ? (
          /* 说明书与授权分成两层：上层有界内滚，下层钉死在页脚正上方。
             为什么调换：权限清单原先住在唯一滚动层的顶部，README 一长它就滚
             出视野——按下「允许并安装」的那一刻，屏幕上没有他正在同意的东西。

             这一层 flex 盒子只为把两段仍旧罩在同一个 preset-confirm 下：
             用户读到的与他同意的是同一次决定，测试问的也是这一整块。
             它只写 min-h-0 不写 flex-1：内容多高就多高，短 README 不会撑出
             一片空白；窗口不够高时收缩全落在 App 介绍那一层，头、授权卡与
             页脚都是 shrink-0——该让路的是散文，不是合同。 */
          <div className="flex min-h-0 flex-col" data-testid="preset-confirm">
            {hasInstallReadme(readme) && (
              /* pl-5 / pr-3 不是 px-5：右边那 8px 留给滚动条自己，
                 正文列才与下方授权卡对得上。scrollbar-gutter 恒定占位，
                 免得拇指现身那一帧整列横移 8px。 */
              <section className="-mx-5 flex min-h-0 flex-col border-b pt-4 pr-3 pb-5 pl-5">
                <h3 className="shrink-0 font-medium text-muted-foreground text-xs">
                  {t("apps.installAboutApp")}
                </h3>
                {/* 为什么这一层要自己也是 flex 且 overflow-hidden：
                    窗口不够高时 section 会被压缩，而 `height: 100%` 的滚动区
                    跟不动——父高是 auto，百分比高度解析成 auto，于是 280px 的
                    盒子原样溢出一个不裁剪的父级，正文越过细线糊在「授权详情」
                    上面。让 wrap 与 scroller 一起 flex-1 + min-h-0，收缩才会
                    一路传下去；overflow-hidden 是兜底：无论高度算成什么，
                    正文都不可能画到这块区域外面去。 */}
                <div className="relative mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
                  <SlimScroller className="max-h-70 min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                    <AppInstallReadme readme={readme} />
                  </SlimScroller>
                  {/* 静置时拇指是透明的，这道渐隐就是「下面还有」的唯一静态证据。
                      颜色必须走 token：写死白色在深色主题下是一条白带。 */}
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-11 bg-gradient-to-b from-transparent to-popover" />
                </div>
              </section>
            )}
            <section className="-mx-5 shrink-0 px-5 py-5">
              <h3 className="font-medium text-muted-foreground text-xs">
                {t("apps.installAuthorizationDetails")}
              </h3>
              <div className="mt-3 flex flex-col gap-4">
                <AppInstallGrants
                  manifest={probe.manifest}
                  permissionLabels={preset.id === "fitness-log"
                    ? {
                        "read-own-data": t("apps.fitnessPermissionRead"),
                        "row-insert": t("apps.fitnessPermissionAdd"),
                      }
                    : undefined}
                  cliStatuses={probe.cliStatuses}
                  extensions={probe.extensionPreflights}
                  extensionRequirements={probe.manifest.extensionRequirements}
                  requirements={probe.requirements}
                  source={{
                    label: probe.channel === "release" ? t("apps.presetSourceRelease") : t("apps.presetSourceDev"),
                    fingerprint: `${probe.repoUrl} · ${probe.resolvedPin.slice(0, 12)} · ${probe.digest.slice(0, 12)}`,
                  }}
                />
                {probe.requirements.length > 0 && (
                  <AppRequirementsForm disabled={stage.kind === "installing"} onChange={setConfig} requirements={probe.requirements} value={config} />
                )}
              </div>
            </section>
          </div>
        ) : error ? (
          <AppDialogBody className="-mx-5 px-5 py-5">
            <div className="space-y-3">
              <p className="rounded-lg bg-destructive/10 p-3 text-destructive text-sm" role="alert">{error}</p>
              <Button onClick={() => void retryProbe()} variant="outline">
                {t("common.retry")}
              </Button>
            </div>
          </AppDialogBody>
        ) : null}
        <DialogFooter className="-mx-5 shrink-0 flex-row justify-end gap-2 border-t px-5 pt-4">
          <Button disabled={stage.kind === "installing"} onClick={close} variant="ghost">{t("apps.presetCancel")}</Button>
          <Button data-testid="preset-install-action" disabled={stage.kind !== "ready" || !ready} onClick={() => void confirmInstall()}>
            {stage.kind === "installing" ? <Spinner className="size-3" /> : <Download />}
            {stage.kind === "installing" ? t("apps.presetInstalling") : t("apps.presetAllowAndInstall")}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
