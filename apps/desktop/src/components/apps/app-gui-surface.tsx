"use client";

/**
 * [INPUT]: Depends on React/zod, shared GUI path with typed host-action, renderer Effective language/host origin, App gui binding and ui button
 * [OUTPUT]: Provides AppGuiBinding and AppGuiSurface with fixed sandbox/fragment, scoped acknowledged host actions, per-surface token checks, rate limits, refresh, and actionable failure modes
 * [POS]: The basic Application GUI of the apps is the main Surface; Uploaded host actions with a narrow white list but not open to general RPC with BaseWorkbench
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  BASE_GUI_ACTION_CHANNEL,
  BASE_GUI_ACTION_RESULT_CHANNEL,
  type BaseGuiHostAction,
} from "../../../shared/apps-ipc";
import { AppWindowIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { isValidGuiPage } from "../../../shared/bases-ipc";
import { useEffectiveLocale } from "@/lib/i18n-locale";
import { useAppTranslation } from "@/components/providers/i18n-provider";

const ENTRY = "index.html";
const hostMessageSchema = z
  .object({
    channel: z.literal(BASE_GUI_ACTION_CHANNEL),
    token: z.string().min(1),
    requestId: z.string().regex(/^host_[a-z0-9_]{3,96}$/),
    action: z.discriminatedUnion("type", [
      z.object({ type: z.literal("open-data") }).strict(),
      z
        .object({
          type: z.literal("open-data-view"),
          viewId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        })
        .strict(),
      z
        .object({
          type: z.literal("compose-text"),
          text: z.string().min(1).max(32_768),
        })
        .strict(),
    ]),
  })
  .strict();

/* capability 不进这里：GUI 页面自己从 `/_api/base/meta` 读 effective 能力位，
   renderer 侧再存一份只会变成第二真相源。 */
export type AppGuiBinding = {
  pages: string[];
  origin: string;
  token: string;
  surfaceLeaseId: string;
  hostActions: readonly import("../../../shared/apps-ipc").BaseGuiHostActionCapability[];
  loading: boolean;
  error?: string;
  refresh(): void;
};

/**
 * 打包后的 renderer 从 `file://` 加载，开发态是 vite 的 `http://localhost:<port>`。
 * 判据只能看 protocol：Chromium 下 file: 页面的 `location.origin` 是字面量
 * `"file://"` 而不是 `"null"`，拿 origin 比字符串永远比不中。
 */
function isFileRenderer() {
  return typeof window === "undefined" || window.location.protocol === "file:";
}

/* GUI 是独立静态页，拿不到 renderer 的 i18n 实例：有效语言只能随 fragment
   一起递过去，让页面自己协商。语言变化会换 src，iframe 重新加载。 */
function guiSource(gui: AppGuiBinding, locale: string) {
  if (!gui.origin || !gui.token || !gui.pages.includes(ENTRY)) return "";
  if (!isValidGuiPage(ENTRY)) return "";
  const url = new URL(ENTRY, `${gui.origin}/`);
  if (url.origin !== gui.origin) return "";
  /* file:// 宿主没有可被子页面命中的网络 origin，postMessage 只能用 "*" 定向
     已知的 parent Window；HTTP 开发态则传递精确 origin。 */
  const hostOrigin = isFileRenderer() ? "*" : window.location.origin;
  url.hash = new URLSearchParams({
    baseToken: gui.token,
    surfaceLeaseId: gui.surfaceLeaseId,
    lang: locale,
    hostOrigin,
  }).toString();
  return url.href;
}

export function AppGuiSurface({
  gui,
  onGoToData,
  onHostAction,
  toolbar,
}: {
  gui: AppGuiBinding;
  onGoToData(): void;
  onHostAction?(action: BaseGuiHostAction): boolean | Promise<boolean>;
  toolbar?: ReactNode;
}) {
  const { t } = useAppTranslation();
  const locale = useEffectiveLocale();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onHostActionRef = useRef(onHostAction);
  const bucketRef = useRef({ tokens: 10, updatedAt: 0 });
  const droppedRef = useRef(0);
  const canCompose = gui.hostActions.includes("compose-text");
  const source = useMemo(() => guiSource(gui, locale), [gui, locale]);
  const refresh = () => {
    setLoaded(false);
    setFailed(false);
    gui.refresh();
  };

  useEffect(() => {
    onHostActionRef.current = onHostAction;
  }, [onHostAction]);

  useEffect(() => {
    bucketRef.current = { tokens: 10, updatedAt: performance.now() };
    /* 「静默丢弃并计数」的计数必须有出口，否则只剩静默。生产态（file://）
       不打点；开发态把累计值与丢弃原因交给 console，四闸误伤时能立刻看见。 */
    const drop = (reason: string) => {
      droppedRef.current += 1;
      if (!isFileRenderer()) {
        console.debug(
          `[app-gui] 丢弃宿主动作消息（${reason}），累计 ${droppedRef.current}`
        );
      }
    };
    const acknowledge = (requestId: string, ok: boolean, error?: string) => {
      iframeRef.current?.contentWindow?.postMessage({
        channel: BASE_GUI_ACTION_RESULT_CHANNEL,
        requestId,
        ok,
        ...(error ? { error } : {}),
      }, gui.origin);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== gui.origin ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        drop("origin-or-source");
        return;
      }
      const parsed = hostMessageSchema.safeParse(event.data);
      if (!parsed.success || !constantTimeText(parsed.data.token, gui.token)) {
        drop("token-or-schema");
        return;
      }
      if (
        parsed.data.action.type === "compose-text" &&
        !canCompose
      ) {
        drop("host-action-not-granted");
        acknowledge(parsed.data.requestId, false, "This App is not allowed to add text to chat.");
        return;
      }
      if (
        parsed.data.action.type === "compose-text" &&
        new TextEncoder().encode(parsed.data.action.text).byteLength > 32 * 1024
      ) {
        drop("host-action-too-large");
        acknowledge(parsed.data.requestId, false, "The Design anchor payload exceeds 32 KiB.");
        return;
      }
      const now = performance.now();
      const bucket = bucketRef.current;
      bucket.tokens = Math.min(10, bucket.tokens + ((now - bucket.updatedAt) / 1_000) * 5);
      bucket.updatedAt = now;
      if (bucket.tokens < 1) {
        drop("rate-limited");
        acknowledge(parsed.data.requestId, false, "Too many requests. Wait a moment and try again.");
        return;
      }
      bucket.tokens -= 1;
      void Promise.resolve(onHostActionRef.current?.(parsed.data.action) ?? true)
        .then((accepted) => acknowledge(
          parsed.data.requestId,
          accepted !== false,
          accepted === false ? "The chat draft could not accept this payload." : undefined
        ))
        .catch((cause) => acknowledge(
          parsed.data.requestId,
          false,
          cause instanceof Error ? cause.message : "The host action failed."
        ));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [canCompose, gui.origin, gui.token, source]);

  return (
    <section
      aria-label={t("bases.gui.surfaceAria")}
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="truncate text-muted-foreground text-xs">
          {ENTRY}
        </span>
        <div className="flex min-w-0 items-center gap-1">
        {toolbar}
        <Button
          aria-label={t("bases.gui.refresh")}
          disabled={gui.loading}
          onClick={refresh}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon />
        </Button>
        </div>
      </div>
      {source && !failed && !gui.error ? (
        <div className="relative min-h-0 flex-1">
          {!loaded && (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">
              {t("bases.gui.loading")}
            </div>
          )}
          <iframe
            key={source}
            ref={iframeRef}
            className="size-full border-0"
            onError={() => setFailed(true)}
            onLoad={() => setLoaded(true)}
            sandbox="allow-scripts allow-same-origin"
            src={source}
            title={t("bases.gui.surfaceAria")}
          />
        </div>
      ) : (
        <GuiFailure
          error={gui.error}
          loading={gui.loading}
          missingEntry={!gui.pages.includes(ENTRY)}
          onGoToData={onGoToData}
          onRetry={refresh}
        />
      )}
    </section>
  );
}

function constantTimeText(left: string, right: string) {
  let difference = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function GuiFailure({
  error,
  loading,
  missingEntry,
  onRetry,
  onGoToData,
}: {
  error?: string;
  loading: boolean;
  missingEntry: boolean;
  onRetry(): void;
  onGoToData(): void;
}) {
  const { t } = useAppTranslation();
  const title = loading
    ? t("bases.gui.connectingTitle")
    : error
      ? t("bases.gui.prepareFailedTitle")
      : missingEntry
        ? t("bases.gui.missingEntryTitle")
        : t("bases.gui.loadFailedTitle");
  const hint = error
    ? error
    : missingEntry
      ? t("bases.gui.missingEntryHint")
      : t("bases.gui.loadFailedHint");
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <AppWindowIcon className="size-8 text-muted-foreground" />
        <p className="font-medium text-sm">{title}</p>
        {!loading && <p className="text-muted-foreground text-xs">{hint}</p>}
        {!loading && (
          <div className="mt-2 flex gap-2">
            <Button onClick={onRetry} size="sm" variant="outline">
              {t("bases.gui.retry")}
            </Button>
            <Button onClick={onGoToData} size="sm">
              {t("bases.gui.goToData")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
