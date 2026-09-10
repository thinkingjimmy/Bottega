/**
 * [INPUT]: Depends on main-owned compatibility facts, the shared updater, router navigation, UI dialog/button/spinner primitives and clipboard access.
 * [OUTPUT]: Provides an in-place install reminder whose footer shape follows how many paths the failure actually has, with the version comparison or the error code carried in an evidence band.
 * [POS]: Shared reminder body for preset, URL, share and update dialogs; it never creates a nested modal.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { updateStore } from "@/lib/update-client";
import { ABOUT_SETTINGS_PATH } from "@/lib/settings-navigation";
import type { AppCompatibilityFailure } from "../../../../shared/app-host/contract";

const REASON_KEYS = {
  APP_HOST_UPDATE_REQUIRED: "appHost.APP_HOST_UPDATE_REQUIRED",
  APP_COMPATIBILITY_MISSING: "appHost.APP_COMPATIBILITY_MISSING",
  APP_COMPATIBILITY_INVALID: "appHost.APP_COMPATIBILITY_INVALID",
  APP_COMPATIBILITY_SCHEMA_UNSUPPORTED: "appHost.APP_COMPATIBILITY_SCHEMA_UNSUPPORTED",
  APP_HOST_VERSION_UNAVAILABLE: "appHost.APP_HOST_VERSION_UNAVAILABLE",
} as const;

/* 命中区借 ::after 撑到 44px，控件本身留在 28px 的房内密度。从前这里写的是
   min-h-11——globals.css 里 touch-target-44 的注释点名它是上一代做法：控件被
   撑高后，文字掉进圆角里（Settings › Skills 的反面教材）。 */
const HIT = "relative touch-target-44 [--touch-target-inset:-4px]";

/* ── 形态跟着「有几条路」走 ──────────────────────────────────────────
 * 五种失败码里只有一种给得出「升级宿主」这条路，其余四种用户能做的只有
 * 重新检查。从前它们共用一排 [ghost 暂不][outline 重新检查]，于是那四种码
 * 的弹窗里没有任何一处在说该点哪个——一道只有一个答案的题，却没有主按钮。
 * 现在没有升级路时，「重新检查」就是那个答案，它长成答案的样子。
 *
 * 升级路还多一个前提：main 得存下这次请求。没有 requestId，checkForApp
 * 无从下手，这笔装到一半的意图也不会出现在 Apps 列表的返回位里。从前那颗
 * 按钮在这种情况下只是 disabled 地杵着，不说为什么；现在它干脆不出现，
 * 弹窗退回「只有一条路」的形态，而不是给一个按不动的答案。
 * ────────────────────────────────────────────────────────────────── */
export function CompatibilityReminder({ failure, onClose, onRetry, appName, busy = false }: {
  failure: AppCompatibilityFailure; onClose(): void; onRetry(): void; appName?: string; busy?: boolean;
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const upgrade = failure.code === "APP_HOST_UPDATE_REQUIRED" && Boolean(failure.requestId);
  const recheck = (
    <Button className={HIT} disabled={busy} onClick={onRetry} variant={upgrade ? "outline" : "default"}>
      {busy && <Spinner className="size-3.5" />}
      {t(busy ? "appHost.rechecking" : "appHost.recheck")}
    </Button>
  );
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto" data-testid="app-compatibility-reminder">
      {/* 播报覆盖描述与证据带两层：版本号从散文里搬走了，但它们仍然是这次
          失败最要紧的事实，不能顺手掉出朗读范围。 */}
      <div aria-live="polite" className="flex flex-col gap-4" role="status">
        <DialogHeader>
          <DialogTitle>{t(upgrade ? "appHost.title" : "appHost.invalidTitle")}</DialogTitle>
          {/* Radix 把 aria-describedby 指向这一个节点，故说明句只能有一份；
              其余处境说明是它的兄弟，靠外面这层 live region 一并被念到。 */}
          <DialogDescription className="break-words whitespace-normal">
            {t(REASON_KEYS[failure.code], { name: appName ?? failure.candidate.appName })}
          </DialogDescription>
          {upgrade && (
            <p className="text-xs/relaxed text-muted-foreground">{t("appHost.resumeAfterUpgrade")}</p>
          )}
          {failure.candidate.hasUsableVersion && (
            <p className="text-xs/relaxed text-muted-foreground">{t("appHost.oldVersionUsable")}</p>
          )}
        </DialogHeader>
        <FailureFacts failure={failure} />
      </div>
      <DialogFooter>
        <Button className={HIT} disabled={busy} onClick={onClose} variant="ghost">
          {t("appHost.cancel")}
        </Button>
        {recheck}
        {upgrade && (
          <Button className={HIT} disabled={busy} onClick={() => {
            onClose();
            updateStore.ensureLoaded();
            void updateStore.checkForApp(failure.requestId!);
            void navigate(ABOUT_SETTINGS_PATH);
          }}>
            {t("appHost.upgrade")}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

/* ── 证据带：要对比的两个数字不该埋在句子里 ──────────────────────────
 * 从前说明句是「需要 Bottega {{minimum}} 或更高版本，你当前使用的是
 * {{current}}」——把两个要比较的数字塞进散文，读者得自己把它们拎出来配对。
 * 并排站着才比得了，而说明句于是可以只说后果。
 *
 * 没有版本可比的那四种码，交出错误码本身：它们的产品出路是「联系作者」，
 * 而作者要的正是这串码——从前弹窗里一个字都没给。
 * ────────────────────────────────────────────────────────────────── */
function FailureFacts({ failure }: { failure: AppCompatibilityFailure }) {
  const { t } = useAppTranslation();
  if (failure.code === "APP_HOST_UPDATE_REQUIRED" && failure.minBottegaVersion) {
    return (
      <div className="flex items-center gap-3 rounded-md border bg-sunken px-2 py-1.5">
        {/* current 可以为 null（版本探测本身就可能失败）。宁可只显示「要求」
            一半，也不要画一个「你的版本 —」出来充数。 */}
        {failure.currentVersion && (
          <Fact label={t("appHost.versionYours")} value={failure.currentVersion} />
        )}
        <Fact emphasis label={t("appHost.versionRequired")} value={failure.minBottegaVersion} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border bg-sunken py-1 pr-1 pl-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {failure.code}
      </code>
      <CopyCode code={failure.code} />
    </div>
  );
}

function Fact({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={emphasis
        ? "font-mono text-foreground font-medium"
        : "font-mono text-muted-foreground"}>
        {value}
      </span>
    </span>
  );
}

function CopyCode({ code }: { code: string }) {
  const { t } = useAppTranslation();
  const [copied, setCopied] = useState(false);
  const label = t(copied ? "appHost.codeCopied" : "appHost.copyCode");
  return (
    <Button
      aria-label={label}
      className={HIT}
      onClick={() => {
        if (!navigator.clipboard?.writeText) return;
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        }).catch(() => {
          // Clipboard denial leaves the code selectable without adding noise.
        });
      }}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
    </Button>
  );
}
