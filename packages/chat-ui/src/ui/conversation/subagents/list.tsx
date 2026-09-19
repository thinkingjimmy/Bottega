/**
 * [INPUT]: Depends on shared projections, host locale/copy, avatars and React timers.
 * [OUTPUT]: Provides a chrome-free SubagentList grouped into Active/Done sections, each row showing avatar, name, a one-line status summary, and relative last-activity time
 * [POS]: conversation/subagents' list surface; the host owns selection and panel chrome.
 */

import type { SubagentProjection } from "./merge";
import { isActiveSubagent } from "./merge";
import type { SidePanelCopy } from "../../../i18n/side-panel";
import { useEffect, useState } from "react";
import { SubagentAvatar } from "./avatar";
import { backendLabel } from "@ai-chat/ui/components/identity/agent";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
type TFunction = (key: string) => string;

const isActive = isActiveSubagent;

function relativeTime(timestamp: number, now: number, locale: string) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const format = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "narrow",
  });
  if (seconds < 60) return format.format(-seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format.format(-hours, "hour");
  return format.format(-Math.floor(hours / 24), "day");
}

function summaryOf(agent: SubagentProjection, t: TFunction) {
  const draft = agent.draft;
  if (!draft) return t("chat.subagent.detailUnavailable");
  const streaming = draft.streaming.map(([, text]) => text).filter(Boolean).at(-1);
  if (streaming) return streaming;
  const part = draft.parts.at(-1);
  if (!part) {
    return isActive(agent)
      ? t("chat.subagent.starting")
      : t("chat.subagent.noTranscript");
  }
  if (part.type === "text") return part.text;
  if (part.type === "subagent") return part.name;
  return part.detail || part.title;
}

function AgentRow({
  agent,
  locale,
  now,
  onOpen,
  t,
  avatarLabel,
}: {
  agent: SubagentProjection;
  locale: string;
  now: number;
  onOpen: () => void;
  t: TFunction;
  avatarLabel?: (name: string) => string;
}) {
  const unavailable = !agent.draft;
  return (
    <button
      className="group grid w-full cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={unavailable}
      onClick={onOpen}
      title={unavailable ? t("chat.subagent.detailLimit") : agent.meta.name}
      type="button"
    >
      <SubagentAvatar
        agent={agent.meta.agent}
        agentThreadId={agent.meta.agentThreadId}
        className="self-center"
        label={agent.meta.agent ? avatarLabel?.(backendLabel(agent.meta.agent)) : undefined}
        size={20}
      />
      <span className="min-w-0">
        <span className="block truncate font-medium text-sm leading-5">
          {agent.meta.name}
        </span>
        <span className="line-clamp-1 text-muted-foreground text-xs leading-4">
          {summaryOf(agent, t)}
        </span>
      </span>
      <span className="pt-0.5 text-muted-foreground text-xs leading-4 tabular-nums">
        {relativeTime(agent.meta.lastActivityAt, now, locale)}
      </span>
    </button>
  );
}

export function SubagentList({
  subagents,
  onOpen,
  locale, copy, empty, avatarLabel,
}: {
  locale: string; copy: SidePanelCopy; empty?: string;
  avatarLabel?: (name: string) => string;
  subagents: Record<string, SubagentProjection>;
  onOpen: (agentThreadId: string) => void;
}) {
  const t: TFunction = key => key === "chat.subagent.empty" ? empty ?? copy.subagentsEmpty : copy[key.split(".").at(-1) as keyof SidePanelCopy] as string;
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const ordered = Object.values(subagents).sort(
    (left, right) =>
      right.meta.lastActivityAt - left.meta.lastActivityAt ||
      left.meta.agentThreadId.localeCompare(right.meta.agentThreadId)
  );
  const active = ordered.filter(isActive);
  const done = ordered.filter((agent) => !isActive(agent));
  const group = (
    title: string,
    agents: SubagentProjection[],
    count?: number
  ) => (
    <section>
      <h2 className="text-muted-foreground text-xs">
        {title}{count === undefined ? "" : ` · ${count}`}
      </h2>
      <div className="mt-4 space-y-2">
        {agents.map((agent) => (
          <AgentRow
            agent={agent}
            key={agent.meta.agentThreadId}
            locale={locale}
            now={now}
            onOpen={() => onOpen(agent.meta.agentThreadId)}
            t={t}
            avatarLabel={avatarLabel}
          />
        ))}
      </div>
    </section>
  );

  return (
      <SlimScroller className="min-h-0 flex-1 overflow-y-auto px-4 py-7">
        {ordered.length ? (
          <div className="space-y-12">
            {active.length ? group(t("chat.subagent.active"), active) : null}
            {done.length ? group(t("chat.subagent.done"), done, done.length) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("chat.subagent.empty")}
          </p>
        )}
      </SlimScroller>
  );
}
