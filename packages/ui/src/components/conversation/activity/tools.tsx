/**
 * [INPUT]: Depends on shared activity data, optional host execution context, Marker, Collapsible, Markdown and Terminal surfaces.
 * [OUTPUT]: Provides collapsed single-line tool and reasoning previews, bounded detail and grouped activity for every host.
 * [POS]: Presentation only; tool execution, file access and subagent navigation stay with callers.
 */
import { useState, type ReactNode } from "react";
import { BrainIcon, ChevronRightIcon, CircleQuestionMarkIcon, CircleXIcon, FilePenIcon, FileSearchIcon, GlobeIcon, ImageIcon, TerminalIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { useScrollLockRelease } from "../../ai-elements/conversation";
import { MessageResponse } from "../../ai-elements/message";
import { MessageRendererProvider } from "../../ai-elements/message/renderer-context";
import { Terminal, TerminalActions, TerminalContent, TerminalCopyButton, TerminalHeader, TerminalTitle } from "../../ai-elements/terminal";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/layout/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "../../ui/feedback/marker";
import { SlimScroller } from "../../ui/layout/slim-scroller";
import { cn } from "../../../lib/utils";
import { groupSummary, type ActivityTool, type GroupedToolPart } from "./groups";
import { useToolActivity, type ToolActivityState } from "./runtime";
import type { CustomRenderer } from "streamdown";

/* D-14: one shared empty list, so tool output never hands MessageResponse a new context value on each render. */
const NO_RENDERERS: CustomRenderer[] = [];
function useFoldState() {
  const [open, setOpen] = useState(false);
  const stopScroll = useScrollLockRelease();
  return [open, (next: boolean) => { if (next) stopScroll(); setOpen(next); }] as const;
}
const TOOL_ICONS = {
  command: TerminalIcon,
  "file-change": FilePenIcon,
  "file-read": FileSearchIcon,
  "web-search": GlobeIcon,
  image: ImageIcon,
  reasoning: BrainIcon,
  "user-input": CircleQuestionMarkIcon,
  "agent-failure": TriangleAlertIcon,
  other: WrenchIcon,
} as const;
function statusIcon(part: ActivityTool) {
  if (part.status === "failed")
    return <CircleXIcon className="text-destructive" />;
  const Icon = TOOL_ICONS[part.tool];
  return <Icon />;
}
function MarkdownDetail({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  return (
    <SlimScroller
      className={cn(
        "my-1 max-h-80 min-w-0 max-w-full overflow-y-auto rounded-md bg-muted/50 p-3 text-muted-foreground text-sm",
        className
      )}
    >
      <MessageRendererProvider value={NO_RENDERERS}>
        <MessageResponse>{text}</MessageResponse>
      </MessageRendererProvider>
    </SlimScroller>
  );
}

function ToolDetail({ part, runtime }: { part: ActivityTool; runtime?: ToolActivityState }) {
  if (part.tool === "reasoning")
    return <MarkdownDetail text={part.detail ?? ""} />;
  if (part.tool === "user-input")
    return (
      <MarkdownDetail
        className="[&_[data-streamdown=strong]]:font-normal [&_[data-streamdown=strong]]:text-foreground"
        text={part.detail ?? ""}
      />
    );
  if (part.tool !== "command") {
    return (
      <SlimScroller className="my-1 max-h-64 min-w-0 max-w-full overflow-y-auto rounded-md bg-muted/50 p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
          {part.detail}
        </pre>
      </SlimScroller>
    );
  }
  return (
    <Terminal
      className="my-1 w-full min-w-0 max-w-full"
      isStreaming={part.status === "running"}
      output={part.detail ?? ""}
    >
      <TerminalHeader>
        <TerminalTitle className="min-w-0">
          <span className="truncate">{part.title}</span>
        </TerminalTitle>
        <TerminalActions>
          <TerminalCopyButton />
          {runtime?.actions}
        </TerminalActions>
      </TerminalHeader>
      {runtime?.description}
      <TerminalContent className="max-h-64 text-xs" />
    </Terminal>
  );
}

function ToolMarker({
  icon,
  open,
  title,
}: {
  icon: ReactNode;
  open?: boolean;
  title: string;
}) {
  return (
    <Marker className="min-w-0 flex-1">
      <MarkerIcon>{icon}</MarkerIcon>
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <MarkerContent>{title}</MarkerContent>
        {open !== undefined && (
          <ChevronRightIcon
            className={cn(
              "pointer-events-none size-3 shrink-0 opacity-0 transition-[opacity,transform] group-hover/tool-toggle:opacity-100 group-focus-visible/tool-toggle:opacity-100 no-hover:opacity-100 motion-reduce:transition-none",
              open && "rotate-90"
            )}
          />
        )}
      </span>
    </Marker>
  );
}

export function ToolRow({ part: original }: { part: GroupedToolPart }) {
  const resolve = useToolActivity();
  const runtime = resolve(original);
  const part = runtime ? { ...original, status: runtime.status, detail: runtime.detail } : original;
  const [open, onOpenChange] = useFoldState();
  const row = (
    <ToolMarker
      icon={statusIcon(part)}
      open={part.detail || runtime ? open : undefined}
      title={part.tool === "reasoning" && !part.merged && part.detail ? part.detail : part.title}
    />
  );
  if (!part.detail && !runtime)
    return <div className="min-w-0 max-w-full py-1" data-activity-item={part.itemId} data-tool-status={part.status}>{row}</div>;
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      onOpenChange={onOpenChange}
      open={open}
      data-activity-item={part.itemId}
      data-tool-status={part.status}
    >
      <CollapsibleTrigger className="group/tool-toggle flex w-full min-w-0 max-w-full cursor-pointer items-center py-1 text-left hover:[&_[data-slot=marker]]:text-foreground pointer-coarse:min-h-11">
        {row}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ToolDetail part={part} runtime={runtime} />
      </CollapsibleContent>
    </Collapsible>
  );
}
function dominantTool(parts: readonly ActivityTool[]): ActivityTool["tool"] {
  const counts = new Map<ActivityTool["tool"], number>();
  for (const part of parts)
    counts.set(part.tool, (counts.get(part.tool) ?? 0) + 1);
  let top = parts[0].tool;
  for (const [tool, count] of counts)
    if (count > (counts.get(top) ?? 0)) top = tool;
  return top;
}

function groupIcon(parts: readonly ActivityTool[]) {
  if (parts.at(-1)?.status === "failed")
    return <CircleXIcon className="text-destructive" />;
  const Icon = TOOL_ICONS[dominantTool(parts)];
  return <Icon />;
}

export function ToolGroup({ parts }: { parts: readonly ActivityTool[] }) {
  const resolve = useToolActivity();
  const current = parts.map(part => { const runtime = resolve(part); return runtime ? { ...part, status: runtime.status } : part; });
  const [open, onOpenChange] = useFoldState();
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger className="group/tool-toggle flex w-full min-w-0 max-w-full cursor-pointer items-center py-1 text-left hover:[&_[data-slot=marker]]:text-foreground pointer-coarse:min-h-11">
        <ToolMarker
          icon={groupIcon(current)}
          open={open}
          title={groupSummary(current)}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 max-w-full">
        <div className="ml-[7px] min-w-0 max-w-full border-l pl-3">
          {parts.map((part) => (
            <ToolRow key={part.itemId} part={part} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
