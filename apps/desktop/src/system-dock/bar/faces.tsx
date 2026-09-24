/**
 * [INPUT]: Depends on the Dock widget face projections, shared Agent logos, lucide state glyphs, and the common limits/activity readings.
 * [OUTPUT]: Provides `LimitsFace` (up to three Agents as ring gauges — the ring is the share of the limit left, orange below 20 %, dimmed and half-drawn when masked — single-source ring with window/reset caption, +N chip, neutral glyphs for non-numeric states, Set up affordance) and `ActivityFace` (today's compact tokens and estimated cost).
 * [POS]: system-dock/bar compact Widget renderers; purely visual, aria-hidden — the item button carries the spoken reading from common/format.
 */

import { CircleAlert, Gauge, KeyRound, Minus } from "lucide-react";
import { AgentBackendIcon } from "@ai-chat/ui/components/identity/agent";
import type { LimitsFaceSource, WidgetFace } from "../../../shared/system-dock/ipc";
import { activityReading, clockText, limitsReading, windowLabel, type DockT } from "../common/format";

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

export function LimitsFace({ face, t, mask, now }: { face: LimitsFaceValue; t: DockT; mask: boolean; now: number }) {
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
      <span className="face-caption">{detail}</span>
    </span>;
  }
  return <span className="face face-limits" aria-hidden="true">
    {face.sources.slice(0, 3).map((source) => <SourceRing key={source.backend} source={source} t={t} mask={mask} now={now} />)}
    {face.more > 0 && <span className="face-more">+{face.more}</span>}
  </span>;
}

export function ActivityFace({ face, t, mask }: { face: ActivityFaceValue; t: DockT; mask: boolean }) {
  const reading = activityReading(face, t, mask);
  const numeric = reading.cost !== "";
  return <span className="face face-activity" aria-hidden="true" data-state={face.state}>
    <span className="face-row">
      {face.state === "error" ? <CircleAlert className="face-glyph" strokeWidth={1.8} /> : <span className="face-value" data-muted={!numeric || undefined}>{reading.tokens}</span>}
      <span className="face-unit">{t("systemDock.activity.faceUnit")}</span>
    </span>
    <span className="face-caption">{numeric ? reading.cost : t("systemDock.activity.faceToday")}</span>
  </span>;
}
