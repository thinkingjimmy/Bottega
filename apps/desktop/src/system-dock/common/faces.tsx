/**
 * [INPUT]: Depends on actual Dock face projections, shared Agent logos/readings, declarative summaries, trusted Weather readings and the caller's exact plugin-card transport.
 * [OUTPUT]: Provides shared `DockWidgetFace` plus `LimitsFace` (up to three Agents as ring gauges — the ring is the share of the limit left, orange below 20 %, dimmed and half-drawn when masked — single-source ring with window/reset caption, +N chip, neutral glyphs for non-numeric states, Set up affordance) `ActivityFace` (today's compact tokens and estimated cost) and `TasksFace` (active/waiting counts and batch results), with vertical stacks and explicit Details when a 48 DIP reading cannot fit.
 * [POS]: Shared Dock and catalog presentation; compact builtins and accepted custom cards use one rendering implementation.
 */

import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { CircleAlert, Gauge, KeyRound, ListTodo, Minus } from "lucide-react";
import { AgentBackendIcon } from "@ai-chat/ui/components/identity/agent";
import type { LimitsFaceSource, WidgetFace, SystemDockBridge } from "../../../shared/system-dock/ipc";
import { activityReading, taskResultLabel, MASK, clockText, limitsReading, windowLabel, type DockT } from "./format";
import './faces.css';
const PluginDockCard = lazy(() => import('./widgets/plugin-card').then(module => ({ default: module.PluginDockCard })));
const DockSummary = lazy(() => import('./widgets/summary').then(module => ({ default: module.DockSummary })));
const WeatherFace = lazy(() => import('./widgets/weather').then(module => ({ default: module.WeatherFace })));

export function DockWidgetFace({ itemId, face, t, mask, now, edge, title, bridge, liveCard = true }: {
  itemId: string; face: WidgetFace; t: DockT; mask: boolean; now: number;
  edge: 'bottom' | 'left' | 'right'; title: string; liveCard?: boolean; bridge?: Pick<SystemDockBridge, 'pluginSurface'>;
}) {
  const locale = document.documentElement.lang || 'en';
  const reading = face.type === "custom" && !mask && face.summary
    ? <Suspense fallback="—">{face.weather
      ? <WeatherFace reading={face.weather} size={face.size} edge={edge} locale={locale} t={t} />
      : <DockSummary node={face.summary} readings={face.readings} locale={locale} />}
    </Suspense> : null;
  const fallback = face.type === "custom" ? <span data-widget-summary="" data-widget-state={face.state} aria-hidden="true"
    style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:'100%',padding:face.weather?0:4,overflow:'hidden',boxSizing:'border-box'}}>
    {mask ? '—' : face.activity ? <ActivityFace face={face.activity} t={t} mask={false} vertical={edge!=='bottom'} />
      : reading ?? <span style={{fontSize:10,lineHeight:1.2,textAlign:'center',whiteSpace:'normal',overflowWrap:'anywhere'}}>{t(`systemDock.widgets.states.${face.state}`)}</span>}
  </span> : null;
  return <div className="dock-widget-face" data-edge={edge} style={{ display:'grid',placeItems:'center',borderRadius:'inherit',color:'var(--text)',font:'13px/1.35 system-ui' }}>
    {face.type === 'custom' ? face.plugin?.customCard && liveCard && !mask && (face.state === 'ready' || face.officialWidget)
      ? <Suspense fallback={fallback}><PluginDockCard itemId={itemId} plugin={face.plugin} bridge={bridge} title={title} unavailable={t('systemDock.item.unavailable')} fallback={fallback}
          presentation={face.officialWidget ? {view:'card',size:face.size,edge,locale} : undefined}/></Suspense>
      : fallback
      : face.type === 'builtin.tasks' ? <TasksFace face={face} t={t} mask={mask} vertical={edge !== 'bottom'} />
        : face.type === 'builtin.ai-limits' ? <LimitsFace face={face} t={t} mask={mask} now={now} vertical={edge !== 'bottom'} />
          : <ActivityFace face={face} t={t} mask={mask} vertical={edge !== 'bottom'} />}
  </div>;
}

type LimitsFaceValue = Extract<WidgetFace, { type: "builtin.ai-limits" }>;
type ActivityFaceValue = Extract<WidgetFace, { type: "builtin.ai-activity" }>;

const RING = { size: 36, radius: 15, stroke: 3 } as const;
const CIRCUMFERENCE = 2 * Math.PI * RING.radius;

/** One Agent as a ring: the arc is what is left, the centre carries the Agent mark over the number (or a state glyph). */
function SourceRing({ source, t, mask, now }: { source: LimitsFaceSource; t: DockT; mask: boolean; now: number }) {
  const reading = limitsReading(source, t, mask, now);
  // Masked readings still draw a ring, but a fixed half one, so its length can never leak the value.
  const share = !reading.numeric ? 0 : mask ? 0.5 : Math.max(0, Math.min(1, (source.remaining ?? 0) / 100));
  // Each non-answer keeps its own shape so "sign in" is never mistaken for "unavailable" at a glance.
  const Glyph = reading.numeric ? null : source.state === "needs-auth" ? KeyRound : source.state === "not-installed" ? Minus : source.state === "loading" ? null : CircleAlert;
  return <span className="face-ring" data-low={reading.low || undefined} data-muted={reading.muted || mask || undefined}>
    <svg viewBox={`0 0 ${RING.size} ${RING.size}`} aria-hidden="true">
      <circle className="face-ring-track" cx={RING.size / 2} cy={RING.size / 2} r={RING.radius} strokeWidth={RING.stroke} />
      {share > 0 && <circle className="face-ring-arc" cx={RING.size / 2} cy={RING.size / 2} r={RING.radius} strokeWidth={RING.stroke}
        strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - share)} transform={`rotate(-90 ${RING.size / 2} ${RING.size / 2})`} />}
    </svg>
    <span className="face-ring-center">
      <AgentBackendIcon backend={source.backend} className="face-ring-logo" />
      {Glyph ? <Glyph className="face-ring-glyph" strokeWidth={2} /> : <span className="face-ring-value">{reading.value.replace("%", "")}</span>}
    </span>
  </span>;
}

export function LimitsFace({ face, t, mask, now, vertical = false }: { face: LimitsFaceValue; t: DockT; mask: boolean; now: number; vertical?: boolean }) {
  if (!face.configured || !face.sources.length) return <span className="face face-setup" aria-hidden="true">
    <Gauge className="face-glyph" strokeWidth={1.8} /><span>{t("systemDock.limits.setUpShort")}</span>
  </span>;
  const single = face.sources.length === 1 && face.more === 0 ? face.sources[0]! : null;
  if (single) {
    const numeric = (single.state === "ok" || single.state === "stale") && single.remaining !== null;
    const detail = !numeric ? limitsReading(single, t, mask, now).note
      : [windowLabel(single, t), ...(!mask && single.resetsAt !== null && single.resetsAt > now ? [clockText(single.resetsAt, now)] : [])].join(" · ");
    return <span className="face face-limits-single" aria-hidden="true">
      <SourceRing source={single} t={t} mask={mask} now={now} />
      <span className="face-caption">{vertical ? <CompactReading value={detail} t={t} /> : detail}</span>
    </span>;
  }
  return <span className="face face-limits" aria-hidden="true">
    {face.sources.slice(0, 3).map((source) => <SourceRing key={source.backend} source={source} t={t} mask={mask} now={now} />)}
    {face.more > 0 && <span className="face-more">+{face.more}</span>}
  </span>;
}

export function ActivityFace({ face, t, mask, vertical = false }: { face: ActivityFaceValue; t: DockT; mask: boolean; vertical?: boolean }) {
  const reading = activityReading(face, t, mask);
  const numeric = reading.cost !== "";
  const caption = numeric ? reading.cost : t("systemDock.activity.faceToday");
  return <span className="face face-activity" aria-hidden="true" data-state={face.state}>
    <span className="face-row">
      {face.state === "error" ? <CircleAlert className="face-glyph" strokeWidth={1.8} /> : <span className="face-value" data-muted={!numeric || undefined}>{vertical ? <CompactReading value={reading.tokens} t={t} /> : reading.tokens}</span>}
      <span className="face-unit">{t("systemDock.activity.faceUnit")}</span>
    </span>
    <span className="face-caption">{vertical ? <CompactReading value={caption} t={t} /> : caption}</span>
  </span>;
}

/** Intrinsic measurement happens before paint; a long value becomes an explicit detail affordance. */
function CompactReading({ value, t }: { value: string; t: DockT }) {
  const measure = useRef<HTMLSpanElement>(null);
  const [details, setDetails] = useState(false);
  useLayoutEffect(() => {
    const width = measure.current?.scrollWidth ?? 0;
    setDetails(width > 48 || (width === 0 && value.length > 7));
  }, [value]);
  return <span className="compact-reading">
    <span ref={measure} className="reading-measure">{value}</span>
    <span className={details ? "reading-details" : undefined}>{details ? t("systemDock.bar.details") : value}</span>
  </span>;
}

export function TasksFace({ face, t, mask, vertical = false }: { face: Extract<WidgetFace, { type: "builtin.tasks" }>; t: DockT; mask: boolean; vertical?: boolean }) {
  const count = mask ? MASK : new Intl.NumberFormat().format((face.running ?? 0) + (face.waiting ?? 0));
  const caption = mask ? MASK : face.waiting ? t("settings.presence.waiting", { tasks: face.waiting })
    : face.running ? t("settings.presence.active") : taskResultLabel(face.result, t);
  return <span className="face face-activity" aria-hidden="true" data-waiting={!mask && Boolean(face.waiting) || undefined}>
    <span className="face-row">{!vertical && <ListTodo className="face-glyph" style={{ color: !mask && face.waiting ? "var(--caution)" : undefined }} />}<span className="face-value">{count}</span>
      {!vertical && <span className="face-unit">{t("systemDock.entry.tasks")}</span>}</span>
    <span className="face-caption">{vertical ? <CompactReading value={caption} t={t} /> : caption}</span>
  </span>;
}
