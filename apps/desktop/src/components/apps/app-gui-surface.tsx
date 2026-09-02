"use client";

/**
 * [INPUT]: Depends on React/zod, shared GUI path with typed host-action, normalized host environment/theme, App gui binding and ui button
 * [OUTPUT]: Provides AppGuiBinding, AppGuiSurface, and guiFailureKind with pre-paint environment, cohort-ready double-buffered activation, superseded-frame release, fixed sandbox/fragment, result-bearing host actions re-checked against the live projection, trusted-gesture file-export staging, per-surface token checks, rate limits, refresh, and failure modes classified by machine code or answer shape
 * [POS]: The basic Application GUI of the apps is the main Surface; Uploaded host actions with a narrow white list but not open to general RPC with BaseWorkbench
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { z } from "zod";
import {
  BASE_GUI_ACTION_CHANNEL,
  BASE_GUI_ACTION_RESULT_CHANNEL,
  type BaseGuiHostAction,
} from "../../../shared/apps-ipc";
import { AppWindowIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { isValidGuiPage } from "../../../shared/bases-ipc";
import { errorMessage, failureCode } from "@/lib/errors";
import { useEffectiveLocale } from "@/lib/i18n-locale";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { onBasesEvent } from "@/lib/bases/client";
import { resolvedThemeStore } from "@/lib/theme";

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
      z.object({
        type: z.literal("file.export.begin"),
        request: z.object({
          version: z.literal(1),
          suggestedName: z.string().min(1).max(255),
          mediaType: z.enum([
            "text/plain;charset=utf-8", "text/csv;charset=utf-8", "application/json",
            "image/png", "image/jpeg", "image/webp", "image/gif",
          ]),
          byteLength: z.number().int().min(1).max(20 * 1024 * 1024),
          sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/)
            .transform((value) => value as `sha256:${string}`),
        }).strict(),
      }).strict(),
      z.object({
        type: z.literal("file.export.chunk"),
        header: z.object({
          exportId: z.string().uuid(),
          seq: z.number().int().nonnegative().max(319),
          byteLength: z.number().int().min(1).max(65_536),
        }).strict(),
        bytes: z.instanceof(Uint8Array),
      }).strict(),
      z.object({ type: z.literal("file.export.finalize"), exportId: z.string().uuid() }).strict(),
      z.object({ type: z.literal("file.export.cancel"), exportId: z.string().uuid() }).strict(),
    ]),
  })
  .strict();
const readyMessageSchema = z
  .object({
    channel: z.literal("bottega:app-gui-ready"),
    leaseId: z.string().min(1),
    readyNonce: z.string().uuid(),
  })
  .strict();

/* capability 不进这里：GUI 页面自己从 `/_api/base/meta` 读 effective 能力位，
   renderer 侧再存一份只会变成第二真相源。 */
export type AppGuiBinding = {
  pages: string[];
  origin: string;
  token: string;
  generationKey?: string;
  bootstrapProtocol?: "load-v0" | "nonce-ready-v1";
  cutoverId?: string;
  surfaceId: string;
  surfaceLeaseId: string;
  hostActions: readonly import("../../../shared/apps-ipc").BaseGuiHostActionCapability[];
  loading: boolean;
  error?: string;
  refresh(): void;
  activate?(): void;
  ready?(readyNonce: string): Promise<Readonly<{ outcome: "committed" | "aborted" }>>;
  release?(): void;
};

/**
 * 打包后的 renderer 从 `file://` 加载，开发态是 vite 的 `http://localhost:<port>`。
 * 判据只能看 protocol：Chromium 下 file: 页面的 `location.origin` 是字面量
 * `"file://"` 而不是 `"null"`，拿 origin 比字符串永远比不中。
 */
function isFileRenderer() {
  return typeof window === "undefined" || window.location.protocol === "file:";
}

type GuiEnvironment = Readonly<{
  locale: string;
  timeZone: string;
  colorScheme: "light" | "dark";
  reducedMotion: boolean;
  density: "comfortable" | "compact";
}>;

/* GUI 是独立静态页，拿不到 renderer 的环境实例。所有首帧可见值必须在
   src 落盘前冻结到 fragment，让 blocking prepaint 在 stylesheet 前消费。 */
function guiSource(
  gui: AppGuiBinding,
  environment: GuiEnvironment,
  readyNonce: string
) {
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
    readyNonce,
    lang: environment.locale.split("-")[0] || "en",
    locale: environment.locale,
    timeZone: environment.timeZone,
    colorScheme: environment.colorScheme,
    reducedMotion: String(environment.reducedMotion),
    density: environment.density,
    hostOrigin,
  }).toString();
  return url.href;
}

type GuiFrame = Readonly<{
  id: string;
  identity: string;
  source: string;
  readyNonce: string;
  gui: AppGuiBinding;
  loaded: boolean;
  failed: boolean;
}>;

type GuiBuffers = Readonly<{
  active: GuiFrame | null;
  candidate: GuiFrame | null;
}>;

function bindingIdentity(gui: AppGuiBinding, environment: GuiEnvironment) {
  if (gui.error || !gui.origin || !gui.token || !gui.pages.includes(ENTRY)) return "";
  return JSON.stringify([
    gui.generationKey ?? "",
    gui.origin,
    gui.token,
    gui.surfaceLeaseId,
    gui.bootstrapProtocol ?? "load-v0",
    gui.cutoverId ?? "",
    environment.locale,
    environment.timeZone,
    environment.colorScheme,
    environment.reducedMotion,
    environment.density,
  ]);
}

function newFrame(
  gui: AppGuiBinding,
  environment: GuiEnvironment,
  identity: string
): GuiFrame {
  const readyNonce = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    identity,
    source: guiSource(gui, environment, readyNonce),
    readyNonce,
    gui: { ...gui },
    loaded: false,
    failed: false,
  };
}

export function AppGuiSurface({
  gui,
  onGoToData,
  onHostAction,
  toolbar,
  chromeless = false,
  baseOwnerKey,
}: {
  gui: AppGuiBinding;
  onGoToData(): void;
  onHostAction?(
    action: BaseGuiHostAction,
    context: Readonly<{ trustedGestureAt: number | null }>
  ): unknown | Promise<unknown>;
  toolbar?: ReactNode;
  baseOwnerKey?: string | null;
  /* 自带四角浮层、且自己在轮询的 GUI 不需要这条栏：它只会重复一遍
     页面已经说过的话，再加一颗对轮询没信心的刷新按钮。 */
  chromeless?: boolean;
}) {
  const { t } = useAppTranslation();
  const locale = useEffectiveLocale();
  const colorScheme = useSyncExternalStore(
    resolvedThemeStore.subscribe,
    resolvedThemeStore.getSnapshot,
    resolvedThemeStore.getSnapshot
  );
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    () => false
  );
  const environment = useMemo<GuiEnvironment>(
    () => ({
      locale: normalizeLocale(locale),
      timeZone: normalizeTimeZone(),
      colorScheme,
      reducedMotion,
      density: "comfortable",
    }),
    [colorScheme, locale, reducedMotion]
  );
  const [buffers, setBuffers] = useState<GuiBuffers>({ active: null, candidate: null });
  const frameElements = useRef(new Map<string, HTMLIFrameElement>());
  const retainedFrames = useRef(new Map<string, GuiFrame>());
  const buffersRef = useRef(buffers);
  const onHostActionRef = useRef(onHostAction);
  const guiRef = useRef(gui);
  const bucketRef = useRef({ tokens: 10, updatedAt: 0 });
  const droppedRef = useRef(0);
  const readyInFlight = useRef(new Set<string>());
  const desiredIdentity = useMemo(
    () => bindingIdentity(gui, environment),
    [environment, gui]
  );
  useEffect(() => {
    buffersRef.current = buffers;
  }, [buffers]);
  useEffect(() => {
    const current = new Map(
      [buffers.active, buffers.candidate]
        .filter((frame): frame is GuiFrame => Boolean(frame))
        .map((frame) => [frame.id, frame])
    );
    for (const [id, frame] of retainedFrames.current) {
      if (!current.has(id)) frame.gui.release?.();
    }
    retainedFrames.current = current;
  });
  const refresh = () => {
    gui.refresh();
  };

  const promote = useCallback((frameId: string) => {
    setBuffers((current) => {
      const candidate = current.candidate;
      if (!candidate || candidate.id !== frameId || candidate.failed) return current;
      return { active: { ...candidate, loaded: true }, candidate: null };
    });
  }, []);

  const markFrame = useCallback(
    (frameId: string, patch: Partial<Pick<GuiFrame, "loaded" | "failed">>) => {
      setBuffers((current) => ({
        active: current.active?.id === frameId
          ? { ...current.active, ...patch }
          : current.active,
        candidate: current.candidate?.id === frameId
          ? { ...current.candidate, ...patch }
          : current.candidate,
      }));
    },
    []
  );

  useEffect(() => {
    if (!desiredIdentity) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBuffers((current) => {
        if (current.active?.identity === desiredIdentity) {
          return current.candidate ? { active: current.active, candidate: null } : current;
        }
        if (
          current.candidate?.identity === desiredIdentity &&
          !current.candidate.failed
        ) {
          return current;
        }
        const frame = newFrame(gui, environment, desiredIdentity);
        if (!current.active && (gui.bootstrapProtocol ?? "load-v0") === "load-v0") {
          return { active: frame, candidate: null };
        }
        return { active: current.active, candidate: frame };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [desiredIdentity, environment, gui]);

  useEffect(() => {
    onHostActionRef.current = onHostAction;
  }, [onHostAction]);

  useEffect(() => {
    guiRef.current = gui;
  }, [gui]);

  useEffect(() => {
    if (!baseOwnerKey) return;
    let eventSeq = 0;
    return onBasesEvent((event) => {
      if (
        (event.type !== "base-changed" && event.type !== "base-migrated") ||
        event.ownerKey !== baseOwnerKey
      ) return;
      eventSeq += 1;
      for (const frame of [buffersRef.current.active, buffersRef.current.candidate]) {
        if (!frame) continue;
        frameElements.current.get(frame.id)?.contentWindow?.postMessage({
          channel: "bottega:base-revision-changed",
          baseInstanceId: event.ownerInstanceId,
          revision: event.revision,
          eventSeq,
        }, frame.gui.origin);
      }
    });
  }, [baseOwnerKey]);

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
    const acknowledge = (
      frame: GuiFrame,
      requestId: string,
      ok: boolean,
      error?: string,
      value?: unknown
    ) => {
      frameElements.current.get(frame.id)?.contentWindow?.postMessage({
        channel: BASE_GUI_ACTION_RESULT_CHANNEL,
        requestId,
        ok,
        ...(error ? { error } : {}),
        ...(value === undefined ? {} : { value }),
      }, frame.gui.origin);
    };
    const onMessage = (event: MessageEvent) => {
      const current = buffersRef.current;
      const candidate = current.candidate;
      const candidateWindow = candidate
        ? frameElements.current.get(candidate.id)?.contentWindow
        : null;
      if (candidate && event.source === candidateWindow) {
        const ready = readyMessageSchema.safeParse(event.data);
        if (
          event.origin === candidate.gui.origin &&
          ready.success &&
          constantTimeText(ready.data.readyNonce, candidate.readyNonce) &&
          ready.data.leaseId === candidate.gui.surfaceLeaseId
        ) {
          if (readyInFlight.current.has(candidate.id)) return;
          if (!candidate.gui.ready) {
            candidate.gui.activate?.();
            promote(candidate.id);
            return;
          }
          readyInFlight.current.add(candidate.id);
          void candidate.gui.ready(ready.data.readyNonce)
            .then(({ outcome }) => {
              if (outcome === "committed") {
                candidate.gui.activate?.();
                promote(candidate.id);
              }
              else markFrame(candidate.id, { failed: true });
            })
            .catch(() => markFrame(candidate.id, { failed: true }))
            .finally(() => readyInFlight.current.delete(candidate.id));
        } else {
          drop("candidate-ready");
        }
        return;
      }
      const active = current.active;
      const activeWindow = active
        ? frameElements.current.get(active.id)?.contentWindow
        : null;
      if (
        !active ||
        event.origin !== active.gui.origin ||
        event.source !== activeWindow
      ) {
        drop("origin-or-source");
        return;
      }
      const parsed = hostMessageSchema.safeParse(event.data);
      if (!parsed.success || !constantTimeText(parsed.data.token, active.gui.token)) {
        drop("token-or-schema");
        return;
      }
      if (
        parsed.data.action.type === "file.export.chunk" &&
        parsed.data.action.bytes.byteLength !== parsed.data.action.header.byteLength
      ) {
        drop("file-export-chunk-length");
        acknowledge(active, parsed.data.requestId, false, "File export chunk length is invalid.");
        return;
      }
      /* 每条消息现读一次当前投影：帧是在创建那一刻冻结的，而撤权发生在
         那之后。只看帧上的旧快照，等于让一个已经被收回的权限继续生效到
         下一次换帧为止。当前投影与帧必须同时批准，缺一即拒。 */
      const granted = (action: "compose-text" | "file.export") =>
        active.gui.hostActions.includes(action) &&
        guiRef.current.hostActions.includes(action);
      if (
        parsed.data.action.type === "compose-text" &&
        !granted("compose-text")
      ) {
        drop("host-action-not-granted");
        acknowledge(active, parsed.data.requestId, false, "This App is not allowed to add text to chat.");
        return;
      }
      if (
        parsed.data.action.type.startsWith("file.export.") &&
        !granted("file.export")
      ) {
        drop("host-action-not-granted");
        acknowledge(active, parsed.data.requestId, false, "This App is not allowed to export files.");
        return;
      }
      const trustedGestureAt = parsed.data.action.type === "file.export.begin"
        ? navigator.userActivation?.isActive === true ? Date.now() : null
        : null;
      if (parsed.data.action.type === "file.export.begin" && trustedGestureAt === null) {
        drop("trusted-gesture-required");
        acknowledge(active, parsed.data.requestId, false, "File export requires a direct user gesture.");
        return;
      }
      if (
        parsed.data.action.type === "compose-text" &&
        new TextEncoder().encode(parsed.data.action.text).byteLength > 32 * 1024
      ) {
        drop("host-action-too-large");
        acknowledge(active, parsed.data.requestId, false, "The compose-text payload exceeds 32 KiB.");
        return;
      }
      if (parsed.data.action.type !== "file.export.chunk") {
        const now = performance.now();
        const bucket = bucketRef.current;
        bucket.tokens = Math.min(10, bucket.tokens + ((now - bucket.updatedAt) / 1_000) * 5);
        bucket.updatedAt = now;
        if (bucket.tokens < 1) {
          drop("rate-limited");
          acknowledge(active, parsed.data.requestId, false, "Too many requests. Wait a moment and try again.");
          return;
        }
        bucket.tokens -= 1;
      }
      void Promise.resolve(onHostActionRef.current?.(parsed.data.action, { trustedGestureAt }) ?? true)
        .then((result) => acknowledge(
          active,
          parsed.data.requestId,
          result !== false,
          result === false ? "The host action was declined." : undefined,
          result === false ? undefined : result
        ))
        .catch((cause) => acknowledge(
          active,
          parsed.data.requestId,
          false,
          cause instanceof Error ? cause.message : "The host action failed."
        ));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [buffers.active?.id, markFrame, promote]);

  const frames = [buffers.active, buffers.candidate].filter(
    (frame): frame is GuiFrame => Boolean(frame)
  );
  const visibleFrameId = buffers.active?.id ?? buffers.candidate?.id ?? "";
  const terminalFailure = !buffers.active && buffers.candidate?.failed;
  const showFrames = frames.length > 0 && !terminalFailure;

  return (
    <section
      aria-label={t("bases.gui.surfaceAria")}
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      {!chromeless && (
        <div className="flex min-h-11 shrink-0 items-center justify-between border-b px-3">
          <span className="truncate text-muted-foreground text-xs">
            {ENTRY}
          </span>
          <div className="flex min-w-0 items-center gap-1">
            {toolbar}
            <Button
              aria-label={t("bases.gui.refresh")}
              disabled={gui.loading}
              onClick={refresh}
              className="size-11"
              size="icon"
              type="button"
              variant="ghost"
            >
              <RefreshCwIcon />
            </Button>
          </div>
        </div>
      )}
      {showFrames ? (
        <div className="relative min-h-0 flex-1">
          {(!buffers.active || !buffers.active.loaded) && (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">
              {t("bases.gui.loading")}
            </div>
          )}
          {frames.map((frame) => {
            const visible = frame.id === visibleFrameId;
            return (
              <iframe
                key={frame.id}
                ref={(element) => {
                  if (element) frameElements.current.set(frame.id, element);
                  else frameElements.current.delete(frame.id);
                }}
                aria-hidden={!visible}
                className={visible
                  ? "absolute inset-0 size-full border-0"
                  : "pointer-events-none invisible absolute inset-0 size-full border-0"}
                onError={() => markFrame(frame.id, { failed: true })}
                onLoad={() => {
                  markFrame(frame.id, { loaded: true });
                  if (
                    (frame.gui.bootstrapProtocol ?? "load-v0") === "load-v0" &&
                    frame.identity === desiredIdentity
                  ) {
                    frame.gui.activate?.();
                    promote(frame.id);
                  }
                }}
                sandbox="allow-scripts allow-same-origin"
                src={frame.source}
                tabIndex={visible ? 0 : -1}
                title={t("bases.gui.surfaceAria")}
              />
            );
          })}
        </div>
      ) : (
        <GuiFailure
          answered={Boolean(gui.origin && gui.token)}
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

function subscribeReducedMotion(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function readReducedMotion() {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function normalizeLocale(value: string) {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? "en-US";
  } catch {
    return "en-US";
  }
}

function normalizeTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function constantTimeText(left: string, right: string) {
  let difference = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/* ============================================================
 * 一句「App data upgrade failed」不能同时解释四种失败
 *
 * 这块面板从前把「授权过期」「换代超时」「面租约没了」「数据迁移失败」
 * 全印成同一句话——而只有最后一种是真的。用户据此做的每一个判断都错，
 * 因为标题本身就是错的。
 *
 * 分类的两个证据：
 *   1. 稳定机器码——main 的断言写成 `CODE: 人话`，码才是分支依据；
 *   2. 形状——main 答上来了（origin/token/入口俱在）而仍带错误，那就是
 *      数据迁移失败；连答复都没有，就是取绑定这一步没成。
 * 码先于形状：换代超时可能带着一份过期但完整的旧绑定回来。
 * ============================================================ */
const GUI_FAILURE_KIND = {
  APP_STUDIO_GRANT_CONFLICT: "permission",
  BASE_GUI_PARTIAL_DECISION: "permission",
  APP_GUI_DRAIN_TIMEOUT: "cutover",
  GUI_CUTOVER_READY_TIMEOUT: "cutover",
  APP_LIFECYCLE_ADMISSION_CLOSED: "cutover",
  APP_INCARNATION_STALE: "surface",
} as const;

const GUI_FAILURE_TITLE_KEY = {
  permission: "bases.gui.permissionFailedTitle",
  cutover: "bases.gui.cutoverFailedTitle",
  surface: "bases.gui.surfaceGoneTitle",
  migration: "bases.gui.prepareFailedTitle",
  "missing-entry": "bases.gui.missingEntryTitle",
  generic: "bases.gui.loadFailedTitle",
} as const;

const GUI_FAILURE_HINT_KEY = {
  permission: "bases.gui.permissionFailedHint",
  cutover: "bases.gui.cutoverFailedHint",
  surface: "bases.gui.surfaceGoneHint",
  migration: "bases.gui.prepareFailedHint",
  "missing-entry": "bases.gui.missingEntryHint",
  generic: "bases.gui.loadFailedHint",
} as const;

export function guiFailureKind(input: {
  error?: string;
  missingEntry: boolean;
  answered: boolean;
}): keyof typeof GUI_FAILURE_TITLE_KEY {
  const coded = GUI_FAILURE_KIND[
    failureCode(input.error ?? "") as keyof typeof GUI_FAILURE_KIND
  ];
  if (coded) return coded;
  if (input.error) return input.answered ? "migration" : "generic";
  return input.missingEntry ? "missing-entry" : "generic";
}

function GuiFailure({
  error,
  loading,
  missingEntry,
  answered,
  onRetry,
  onGoToData,
}: {
  error?: string;
  loading: boolean;
  missingEntry: boolean;
  answered: boolean;
  onRetry(): void;
  onGoToData(): void;
}) {
  const { t } = useAppTranslation();
  const kind = guiFailureKind({ error, missingEntry, answered });
  /* 码剥净后可能什么都不剩（只有码没有人话的那种断言）。此时详情行不出现，
     解释全交给上面那句本地化的 hint——把码念给用户听不是解释。 */
  const detail = error ? errorMessage(error) : "";
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <AppWindowIcon className="size-8 text-muted-foreground" />
        <p className="font-medium text-sm">
          {loading ? t("bases.gui.connectingTitle") : t(GUI_FAILURE_TITLE_KEY[kind])}
        </p>
        {!loading && (
          <p className="text-muted-foreground text-xs">
            {t(GUI_FAILURE_HINT_KEY[kind])}
          </p>
        )}
        {!loading && detail && (
          <p className="text-muted-foreground/70 text-xs">{detail}</p>
        )}
        {!loading && (
          <div className="mt-2 flex gap-2">
            <Button className="min-h-11" onClick={onRetry} size="sm" variant="outline">
              {t("bases.gui.retry")}
            </Button>
            <Button className="min-h-11" onClick={onGoToData} size="sm">
              {t("bases.gui.goToData")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
