"use client";

/**
 * [INPUT]: Depends on trusted AppRecord/AppGuiBinding projections, localized copy, Dialog/Button primitives, and the generation-embedded Workbench protocol
 * [OUTPUT]: Provides the Studio App Workbench environment/failure matrix, tokenless current-generation preview, active-generation/build facts, executable keyboard/focus/axe/CSP/sandbox checks, and an actual-generation visual capture
 * [POS]: Trusted renderer quality surface for compiled Apps; it loads sealed production bytes with the SDK's versioned Base fixture and no Base token or Host Action bridge
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type { AppRecord } from "../../../shared/apps-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { AppGuiBinding } from "./app-gui-surface";

type Scenario = "ready" | "loading" | "empty" | "permission" | "network" | "conflict" | "unknown" | "large";
type Theme = "light" | "dark";
type Viewport = "regular" | "narrow";
type Density = "comfortable" | "compact";
type CheckId = "keyboard" | "focus" | "axe" | "visual" | "csp" | "sandbox" | "performance";
type CheckResult = Readonly<{
  state: "not-run" | "running" | "passed" | "failed";
  detail?: string;
}>;

const CHECKS: readonly CheckId[] = [
  "keyboard",
  "focus",
  "axe",
  "visual",
  "csp",
  "sandbox",
  "performance",
];

const EMPTY_CHECKS = Object.fromEntries(
  CHECKS.map((id) => [id, { state: "not-run" }])
) as Record<CheckId, CheckResult>;

export function AppWorkbench({
  gui,
  onOpenChange,
  open,
  record,
}: {
  gui: AppGuiBinding;
  onOpenChange(open: boolean): void;
  open: boolean;
  record: AppRecord;
}) {
  const { t } = useAppTranslation();
  const [scenario, setScenario] = useState<Scenario>("ready");
  const [theme, setTheme] = useState<Theme>("light");
  const [viewport, setViewport] = useState<Viewport>("regular");
  const [locale, setLocale] = useState("en-US");
  const [timeZone, setTimeZone] = useState("UTC");
  const [density, setDensity] = useState<Density>("comfortable");
  const [zoom, setZoom] = useState("100");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [checks, setChecks] = useState<Record<CheckId, CheckResult>>(EMPTY_CHECKS);
  const [screenshot, setScreenshot] = useState<{ url: string; digest: string } | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const activeId = record.generationBinding.active?.generationId;
  const generation = record.generations.find((item) => item.generationId === activeId);
  const preview = useMemo(
    () => workbenchSource(gui, { scenario, theme, reducedMotion, locale, timeZone, density }),
    [density, gui, locale, reducedMotion, scenario, theme, timeZone]
  );
  const finding = gui.error || record.lastError?.message || "";
  useEffect(() => {
    queueMicrotask(() => setChecks(EMPTY_CHECKS));
  }, [preview, viewport, zoom]);
  useEffect(
    () => () => {
      if (screenshot) URL.revokeObjectURL(screenshot.url);
    },
    [screenshot]
  );

  const runChecks = async () => {
    const frame = frameRef.current;
    if (!frame || !preview.source) return;
    setChecks(Object.fromEntries(CHECKS.map((id) => [id, { state: "running" }])) as Record<CheckId, CheckResult>);
    try {
      const result = await requestWorkbenchChecks(
        frame,
        gui.origin,
        preview.secret,
        scenario === "empty" ? 0 : scenario === "large" ? 10_000 : 48
      );
      const visual = result.visual.bytes
        ? {
            url: URL.createObjectURL(new Blob([result.visual.bytes], { type: "image/png" })),
            digest: result.visual.digest ?? "",
          }
        : null;
      setScreenshot((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return visual;
      });
      setChecks({
        keyboard: result.checks.keyboard,
        focus: result.checks.focus,
        axe: result.checks.axe,
        csp: result.checks.csp,
        sandbox: checkSandbox(frame),
        performance: result.checks.performance,
        visual: visual ? passed(visual.digest) : failed(result.visual.error ?? "Visual capture failed"),
      });
    } catch (cause) {
      setChecks(Object.fromEntries(CHECKS.map((id) => [id, failed(errorMessage(cause))])) as Record<CheckId, CheckResult>);
    }
  };
  return <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="flex h-[min(52rem,calc(100vh-2rem))] max-w-[min(76rem,calc(100vw-2rem))] grid-rows-none flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b p-5 pr-14">
        <DialogTitle>{t("apps.baseDetail.workbench")}</DialogTitle>
        <DialogDescription>{t("apps.baseDetail.workbenchDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[19rem_1fr]">
        <aside className="min-h-0 overflow-auto border-b p-4 lg:border-r lg:border-b-0">
          <fieldset className="grid gap-3">
            <legend className="mb-2 font-medium text-sm">{t("apps.baseDetail.workbenchEnvironment")}</legend>
            <WorkbenchSelect label={t("apps.baseDetail.workbenchScenario")} value={scenario} onChange={(value) => setScenario(value as Scenario)} options={["ready", "loading", "empty", "permission", "network", "conflict", "unknown", "large"]} />
            <WorkbenchSelect label={t("apps.baseDetail.workbenchTheme")} value={theme} onChange={(value) => setTheme(value as Theme)} options={["light", "dark"]} />
            <WorkbenchSelect label={t("apps.baseDetail.workbenchLocale")} value={locale} onChange={setLocale} options={["en-US", "zh-CN", "ja-JP"]} />
            <WorkbenchSelect label={t("apps.baseDetail.workbenchTimeZone")} value={timeZone} onChange={setTimeZone} options={["UTC", "Asia/Shanghai", "America/Los_Angeles"]} />
            <WorkbenchSelect label={t("apps.baseDetail.workbenchDensity")} value={density} onChange={(value) => setDensity(value as Density)} options={["comfortable", "compact"]} />
            <WorkbenchSelect label={t("apps.baseDetail.workbenchViewport")} value={viewport} onChange={(value) => setViewport(value as Viewport)} options={["regular", "narrow"]} />
            <WorkbenchSelect label={t("apps.baseDetail.workbenchZoom")} value={zoom} onChange={setZoom} options={["80", "100", "125", "150"]} />
            <label className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm"><input checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} type="checkbox" />{t("apps.baseDetail.workbenchReducedMotion")}</label>
          </fieldset>
          <section className="mt-6 grid gap-2" aria-label={t("apps.baseDetail.workbenchBuildStatus")}>
            <h3 className="font-medium text-sm">{t("apps.baseDetail.workbenchBuildStatus")}</h3>
            <Fact label={t("apps.baseDetail.workbenchGeneration")} value={activeId ?? "—"} />
            <Fact label={t("apps.baseDetail.workbenchLayout")} value={String(generation?.contentLayoutVersion ?? "—")} />
            <Fact label={t("apps.baseDetail.workbenchSource")} value={generation && "sourcePackageDigest" in generation ? generation.sourcePackageDigest ?? "—" : "—"} />
            <Fact label={t("apps.baseDetail.workbenchBudgets")} value="4 MiB / 2 MiB" />
            {finding && <p className="rounded-md border border-destructive/40 p-3 text-destructive text-xs" role="alert">{t("apps.baseDetail.workbenchFinding")} {finding}</p>}
          </section>
        </aside>
        <section className="flex min-h-0 flex-col bg-muted/20 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">{t("apps.baseDetail.workbenchUnauthorized")}</p>
            <Button className="min-h-11" onClick={() => void runChecks()} type="button" variant="outline">{t("apps.baseDetail.workbenchRunChecks")}</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border bg-background p-3">
            <iframe
              className={viewport === "narrow" ? "mx-auto h-full w-[22rem] max-w-full border-0" : "size-full border-0"}
              key={`${scenario}:${theme}:${locale}:${timeZone}:${density}:${reducedMotion}`}
              ref={frameRef}
              sandbox="allow-same-origin allow-scripts"
              src={preview.source || "about:blank"}
              style={{ zoom: `${zoom}%` }}
              title={t("apps.baseDetail.workbenchPreview")}
            />
          </div>
          <div aria-live="polite" className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            {CHECKS.map((check) => <CheckCard id={check} key={check} result={checks[check]} />)}
          </div>
          {screenshot && <figure className="mt-3 flex min-h-0 items-center gap-3 rounded-md border bg-background p-2"><img alt={t("apps.baseDetail.workbenchScreenshot")} className="h-16 w-28 rounded border object-contain" src={screenshot.url} /><figcaption className="min-w-0 text-xs"><span className="block font-medium">{t("apps.baseDetail.workbenchScreenshot")}</span><code className="block truncate text-muted-foreground">{screenshot.digest}</code></figcaption></figure>}
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}

function WorkbenchSelect({ label, onChange, options, value }: { label: string; value: string; options: string[]; onChange(value: string): void }) {
  return <label className="grid gap-1 text-sm">{label}<select className="min-h-11 rounded-md border bg-background px-3" onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 rounded-md border p-2 text-xs"><span className="text-muted-foreground">{label}</span><code className="truncate">{value}</code></div>;
}

function CheckCard({ id, result }: { id: CheckId; result: CheckResult }) {
  return <div className="rounded-md border bg-background p-2"><span className="font-medium">{id}</span><span className={result.state === "failed" ? "ml-2 text-destructive" : "ml-2 text-muted-foreground"}>{result.state}</span>{result.detail && <p className="mt-1 line-clamp-2 text-muted-foreground">{result.detail}</p>}</div>;
}

type WorkbenchEnvironment = Readonly<{
  scenario: Scenario;
  theme: Theme;
  reducedMotion: boolean;
  locale: string;
  timeZone: string;
  density: Density;
}>;

type WorkbenchCheckResponse = Readonly<{
  checks: Readonly<{
    keyboard: CheckResult;
    focus: CheckResult;
    axe: CheckResult;
    csp: CheckResult;
    performance: CheckResult;
  }>;
  visual: Readonly<{ digest?: string; bytes?: ArrayBuffer; error?: string }>;
}>;

const checkResultSchema = z.object({
  state: z.enum(["passed", "failed"]),
  detail: z.string().max(1_000).optional(),
}).strict();
const workbenchCheckResponseSchema = z.object({
  channel: z.literal("bottega:workbench-check-result"),
  requestId: z.string().uuid(),
  workbenchSecret: z.string().regex(/^[a-f0-9]{64}$/),
  fixture: z.object({
    id: z.literal("base-v1"),
    rows: z.number().int().min(0).max(10_000),
    columns: z.literal(20),
  }).strict(),
  checks: z.object({
    keyboard: checkResultSchema,
    focus: checkResultSchema,
    axe: checkResultSchema,
    csp: checkResultSchema,
    performance: checkResultSchema,
  }).strict(),
  visual: z.union([
    z.object({
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      bytes: z.instanceof(ArrayBuffer).refine(
        (bytes) => bytes.byteLength > 0 && bytes.byteLength <= 8 * 1024 * 1024,
        "Workbench screenshot exceeds its byte budget"
      ),
    }).strict(),
    z.object({ error: z.string().min(1).max(1_000) }).strict(),
  ]),
}).strict();

function workbenchSource(gui: AppGuiBinding, environment: WorkbenchEnvironment) {
  if (!gui.origin || !gui.pages.includes("index.html") || gui.bootstrapProtocol !== "nonce-ready-v1") {
    return { source: "", secret: "" } as const;
  }
  const url = new URL("index.html", `${gui.origin}/`);
  if (url.origin !== gui.origin) return { source: "", secret: "" } as const;
  const secret = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  url.hash = new URLSearchParams({
    baseToken: "",
    surfaceLeaseId: "",
    readyNonce: crypto.randomUUID(),
    lang: environment.locale.split("-")[0] || "en",
    locale: environment.locale,
    timeZone: environment.timeZone,
    colorScheme: environment.theme,
    reducedMotion: String(environment.reducedMotion),
    density: environment.density,
    hostOrigin: window.location.protocol === "file:" ? "*" : window.location.origin,
    workbenchFixture: "base-v1",
    workbenchScenario: environment.scenario,
    workbenchSecret: secret,
  }).toString();
  return { source: url.href, secret } as const;
}

function requestWorkbenchChecks(
  frame: HTMLIFrameElement,
  guiOrigin: string,
  secret: string,
  expectedRows: number
) {
  return new Promise<WorkbenchCheckResponse>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => finish(new Error("Current generation did not return Workbench checks")), 15_000);
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== guiOrigin
      ) return;
      const parsed = workbenchCheckResponseSchema.safeParse(event.data);
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        !constantTimeText(parsed.data.workbenchSecret, secret) ||
        parsed.data.fixture.rows !== expectedRows
      ) return;
      void verifyWorkbenchVisual(parsed.data.visual).then(
        () => finish(null, parsed.data),
        (cause) => finish(cause instanceof Error ? cause : new Error(String(cause)))
      );
    };
    const finish = (error: Error | null, value?: WorkbenchCheckResponse) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (error) reject(error);
      else resolve(value!);
    };
    window.addEventListener("message", onMessage);
    frame.contentWindow?.postMessage({ channel: "bottega:workbench-check", requestId }, guiOrigin);
  });
}

async function verifyWorkbenchVisual(visual: WorkbenchCheckResponse["visual"]) {
  if (!visual.bytes || !visual.digest) return;
  const hash = await crypto.subtle.digest("SHA-256", visual.bytes);
  const digest = `sha256:${[...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
  if (!constantTimeText(digest, visual.digest)) {
    throw new Error("Workbench screenshot digest does not match its bytes");
  }
}

function constantTimeText(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function checkSandbox(frame: HTMLIFrameElement) {
  const expected = ["allow-same-origin", "allow-scripts"];
  const actual = [...frame.sandbox].sort();
  return actual.length === expected.length && expected.every((token) => actual.includes(token))
    ? passed("Exact production sandbox: scripts and isolated-origin runtime only")
    : failed(`Unexpected sandbox authority: ${actual.join(", ") || "none"}`);
}

function passed(detail: string): CheckResult {
  return { state: "passed", detail };
}

function failed(detail: string): CheckResult {
  return { state: "failed", detail };
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
