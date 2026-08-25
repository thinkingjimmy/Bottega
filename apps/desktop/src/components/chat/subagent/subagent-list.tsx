/**
 * [INPUT]: Depends on the renderer ProjectedSubagent, SubagentAvatar and React click back
 * [OUTPUT]: Provides a chrome-free SubagentList with a compact abstract in a relatively binary vertical residence with headings showing detailed inputs in the Active/Done category
 * [POS]: The chat/subagent session level navigation page; Chrome is in PanelTabs, read only projections and does not have agent status
 */

import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import { useEffect, useState } from "react";
import { SubagentAvatar } from "./subagent-avatar";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";

const isActive = (agent: ProjectedSubagent) =>
  ["pendingInit", "running"].includes(agent.meta.status);

function relativeTime(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return seconds < 10 ? "now" : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function summaryOf(agent: ProjectedSubagent) {
  const draft = agent.draft;
  if (!draft) return "Realtime detail is unavailable.";
  const streaming = [...draft.streaming.values()].filter(Boolean).at(-1);
  if (streaming) return streaming;
  const part = draft.parts.at(-1);
  if (!part) return isActive(agent) ? "Starting…" : "No transcript captured.";
  if (part.type === "text") return part.text;
  if (part.type === "subagent") return part.name;
  return part.detail || part.title;
}

function AgentRow({
  agent,
  now,
  onOpen,
}: {
  agent: ProjectedSubagent;
  now: number;
  onOpen: () => void;
}) {
  const unavailable = !agent.draft;
  return (
    <button
      className="group grid w-full cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={unavailable}
      onClick={onOpen}
      title={unavailable ? "实时详情已达上限" : agent.meta.name}
      type="button"
    >
      <SubagentAvatar
        agent={agent.meta.agent}
        agentThreadId={agent.meta.agentThreadId}
        className="self-center"
        size={20}
      />
      <span className="min-w-0">
        <span className="block truncate font-medium text-sm leading-5">
          {agent.meta.name}
        </span>
        <span className="line-clamp-1 text-muted-foreground text-xs leading-4">
          {summaryOf(agent)}
        </span>
      </span>
      <span className="pt-0.5 text-muted-foreground text-xs leading-4 tabular-nums">
        {relativeTime(agent.meta.lastActivityAt, now)}
      </span>
    </button>
  );
}

export function SubagentList({
  subagents,
  onOpen,
}: {
  subagents: Record<string, ProjectedSubagent>;
  onOpen: (agentThreadId: string) => void;
}) {
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
    agents: ProjectedSubagent[],
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
            now={now}
            onOpen={() => onOpen(agent.meta.agentThreadId)}
          />
        ))}
      </div>
    </section>
  );

  return (
      <SlimScroller className="min-h-0 flex-1 overflow-y-auto px-4 py-7">
        {ordered.length ? (
          <div className="space-y-12">
            {active.length ? group("Active", active) : null}
            {done.length ? group("Done", done, done.length) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            This conversation has no subagents yet.
          </p>
        )}
      </SlimScroller>
  );
}
