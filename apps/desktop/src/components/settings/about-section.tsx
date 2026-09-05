/**
 * [INPUT]: Depends on React external-store hooks, lib/brand identity, lib/about-view verdicts, Settings layout primitives, update-client stores, app external-link/clipboard IPC, ui Collapsible/Button, lucide glyphs, and About i18n
 * [OUTPUT]: Provides AboutSection with a product identity block, an on-demand update receipt whose failure alert carries its own resolution sentence, the bundled MIT license behind an inline trigger, and three external link rows
 * [POS]: Settings › About business component; main owns the facts, lib/about-view owns the verdicts, this file only renders them and invokes typed commands
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsAlert,
  SettingsButton,
  SettingsLinkRow,
  SettingsList,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-layout";
import {
  describeUpdate,
  formatAppDiagnostics,
  type UpdateGlyph,
  type UpdateTone,
} from "@/lib/about-view";
import { openExternal, writeClipboardText } from "@/lib/agent-client";
import { PRODUCT_MARK_SIZE, PRODUCT_MARK_URL, PRODUCT_NAME } from "@/lib/brand";
import { appInfoStore, RELEASE_URL, updateStore } from "@/lib/update-client";
import { ISSUES_URL, REPOSITORY_URL } from "@/lib/report-issue";

/* 仓库行的说明位就是它的去处本身，故不进 i18n 目录：域名不是文案。 */
const REPOSITORY_HOST = REPOSITORY_URL.replace(/^https:\/\//, "");

/* 字形与语气都查表，不写分支：about-view 里新增一档只加一行，这里一个字不改。 */
const GLYPHS: Record<UpdateGlyph, typeof CircleCheck> = {
  spinner: LoaderCircle,
  check: CircleCheck,
  download: Download,
  alert: CircleAlert,
};

const TONES: Record<UpdateTone, string> = {
  quiet: "text-muted-foreground",
  loud: "font-medium text-foreground",
  /* danger 不在这一行落地——它走下面的 SettingsAlert，见 alarming。 */
  danger: "text-destructive",
};

export function AboutSection() {
  const { t } = useAppTranslation();
  const update = useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getSnapshot
  );
  const appInfo = useSyncExternalStore(
    appInfoStore.subscribe,
    appInfoStore.getSnapshot
  );
  /* 这一位就是「这次结论是不是你要来的」。静息态不说话的全部机关在此，
     不需要计时器，也不需要在 phase 之外再造一个状态机。 */
  const [checkedHere, setCheckedHere] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    updateStore.ensureLoaded();
    appInfoStore.ensureLoaded();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const version = appInfo?.version || update.currentVersion || "—";
  const checkedAt = update.checkedAt
    ? t("settings.about.checkedAt", {
        time: new Date(update.checkedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      })
    : "";

  const view = describeUpdate(update, checkedHere, Boolean(window.update));
  /* checkedAt 无条件并进插值表：用不到它的键会自己忽略，
     而写成分支就得为「哪几句需要时间」再维护一份名单。 */
  const message = view.messageKey
    ? t(view.messageKey, { checkedAt, ...view.messageVars })
    : "";
  /* 失败信息是一串原始报错，塞不进版本行那半行宽度——截断的报错等于没报。
     故它独占一条 SettingsAlert：能换行，且 role="alert" 比 polite 更该被听见。 */
  const alarming = view.tone === "danger";
  const Glyph = view.glyph ? GLYPHS[view.glyph] : null;

  const check = () => {
    setCheckedHere(true);
    void updateStore.check();
  };
  const upgrade = () =>
    update.automaticInstall
      ? updateStore.downloadAndInstall()
      : openExternal(RELEASE_URL);
  const copyDiagnostics = () => {
    void writeClipboardText(
      formatAppDiagnostics({
        productName: PRODUCT_NAME,
        version,
        electron: appInfo?.electron ?? "—",
        platform: appInfo?.platform ?? "—",
      })
    ).then(
      () => setCopied(true),
      () => {}
    );
  };

  return (
    <div className="space-y-8">
      {/* Collapsible 收住身份块与协议正文：触发器是版本行里那个词，
          面板落在整块之下，两者必须同处一个 Root 才是同一次开合。 */}
      <Collapsible>
        {/* gap-8 而非 gap-5：旧图右侧那 13.6px 透明留白曾冒充间距，
            裁掉后光学间隙会从 33.6px 塌回 20px。这里把它显式写回来。 */}
        <section className="flex items-start gap-8">
          <img
            src={PRODUCT_MARK_URL}
            width={PRODUCT_MARK_SIZE.width}
            height={PRODUCT_MARK_SIZE.height}
            alt=""
            aria-hidden="true"
            className="h-20 w-auto shrink-0"
          />
          <div className="min-w-0 flex-1">
            {/* 身份块与徽标等高：min-h-20 是这一块唯一的高度声明，
                justify-between 把标题顶边与版本行底边分别推到徽标的上下沿，
                「等高」于是看得见——而不是三个外边距碰巧加到 80 的巧合。
                写 min- 而非定高：窄宽下版本行会折行，那时它该长高，
                而不是把文字压出盒子。 */}
            <div className="flex min-h-20 flex-col justify-between">
              <div>
                {/* 身份的真源只有 brand.ts 一处。AppInfo 曾也运送一份产品名，
                    但它在未打包运行时是 package.json 里的 @ai-chat/desktop——
                    同一个东西两个出处，其中一个还会说错话，于是它被删掉了。 */}
                <h2 className="font-heading font-semibold text-xl leading-none tracking-[-0.015em]">
                  {PRODUCT_NAME}
                </h2>
                <p className="mt-0.5 text-pretty text-muted-foreground text-sm">
                  {t("settings.about.tagline")}
                </p>
              </div>

              <div className="flex items-center justify-between gap-6">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {t("settings.about.version", { version })} ·{" "}
                    <CollapsibleTrigger
                      aria-label={t("settings.about.readLicense")}
                      className="cursor-pointer rounded-sm text-foreground underline decoration-border underline-offset-2 outline-none transition-colors hover:decoration-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
                    >
                      {t("settings.about.licenseName")}
                    </CollapsibleTrigger>
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t("settings.about.copyDiagnostics")}
                    className="shrink-0 text-muted-foreground"
                    onClick={copyDiagnostics}
                  >
                    {copied ? (
                      <Check data-icon="inline-start" />
                    ) : (
                      <Copy data-icon="inline-start" />
                    )}
                    {copied
                      ? t("settings.about.copied")
                      : t("settings.about.copy")}
                  </Button>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {Glyph && !alarming && (
                      <Glyph
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0",
                          view.tone === "quiet"
                            ? "text-muted-foreground"
                            : "text-foreground"
                        )}
                      />
                    )}
                    {/* 常驻 DOM 而非按需插入：读屏对「刚出现的 live region」
                        并不可靠，空着才是它的静息态。 */}
                    <p
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                      className={cn("text-xs", TONES[view.tone])}
                    >
                      {alarming ? "" : message}
                    </p>
                    {view.percent !== null && (
                      <>
                        <span
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={view.percent}
                          aria-label={message}
                          className="h-1 w-30 shrink-0 overflow-hidden rounded-full bg-foreground/10"
                        >
                          <span
                            className="block h-full rounded-full bg-foreground transition-[width] motion-reduce:transition-none"
                            style={{ width: `${view.percent}%` }}
                          />
                        </span>
                        {/* 百分比走 tabular-nums：等宽数字才不会每帧把进度条推着走。 */}
                        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                          {view.percent}%
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <SettingsButton
                      aria-label={t("settings.about.check")}
                      variant="outline"
                      disabled={view.blocked}
                      onClick={check}
                    >
                      {t("settings.about.check")}
                    </SettingsButton>
                    {view.upgradeKey && (
                      <SettingsButton
                        aria-label={t(view.upgradeKey)}
                        onClick={() => void upgrade()}
                      >
                        {t(view.upgradeKey)}
                      </SettingsButton>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {alarming && (
              <div className="mt-3">
                {/* 出路跟着报错走，不另起一条 alert：它是同一件事的下半句，
                    分成两块红框只会让人以为出了两个问题。 */}
                <SettingsAlert>
                  {message}
                  {view.resolutionKey && (
                    <span className="mt-1 block opacity-80">
                      {t(view.resolutionKey)}
                    </span>
                  )}
                </SettingsAlert>
              </div>
            )}
          </div>
        </section>

        <CollapsibleContent className="pt-4">
          {/* 随包正本读不到时，位置与形状不变，只是内容换成一句解释——
              界面的形状不该由「那个文件这次能不能读」决定。在线正本
              因此常驻：它对两种情况都成立。 */}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed">
            {appInfo?.licenseText ?? t("settings.about.licenseUnavailable")}
          </pre>
          <SettingsButton
            aria-label={t("settings.about.licenseCanonical")}
            variant="ghost"
            className="-ml-3 mt-2 text-muted-foreground"
            onClick={() =>
              void openExternal(
                appInfo?.licenseUrl ?? `${REPOSITORY_URL}/blob/main/LICENSE`
              )
            }
          >
            {t("settings.about.licenseCanonical")}
            <ArrowUpRight data-icon="inline-end" />
          </SettingsButton>
        </CollapsibleContent>
      </Collapsible>

      {appInfo?.platformSupport.tier === "preview" && (
        <SettingsSection
          title={t("settings.about.platformSupport")}
          description={t("settings.about.previewDescription")}
        >
          <SettingsSurface className="px-4 py-3">
            <p className="flex items-center gap-2 font-medium text-sm">
              <TriangleAlert
                aria-hidden="true"
                className="size-4 shrink-0 text-amber-700 dark:text-amber-400"
              />
              {t("settings.about.preview", { platform: appInfo.platform })}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground text-xs">
              {Object.entries(appInfo.platformSupport.capabilities)
                .filter(([, available]) => !available)
                .map(([capability]) => (
                  <li key={capability}>
                    {t(`settings.about.features.${capability}`)}
                  </li>
                ))}
            </ul>
          </SettingsSurface>
        </SettingsSection>
      )}

      <SettingsSection title={t("settings.about.links")}>
        <SettingsList>
          <SettingsLinkRow
            label={t("settings.about.repository")}
            description={REPOSITORY_HOST}
            onSelect={() => void openExternal(REPOSITORY_URL)}
          />
          <SettingsLinkRow
            label={t("settings.about.feedback")}
            description={t("settings.about.feedbackDescription")}
            onSelect={() => void openExternal(ISSUES_URL)}
          />
          <SettingsLinkRow
            label={t("settings.about.releaseNotes")}
            description={t("settings.about.releaseNotesDescription")}
            onSelect={() => void openExternal(RELEASE_URL)}
          />
        </SettingsList>
      </SettingsSection>
    </div>
  );
}
