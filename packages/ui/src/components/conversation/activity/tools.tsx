/**
 * [INPUT]: Depends on shared activity data, Marker, Collapsible, Markdown and Terminal surfaces.
 * [OUTPUT]: Provides the native tool rows, reasoning detail and grouped activity for every host.
 * [POS]: Presentation only; tool execution, file access and subagent navigation stay with callers.
 */
import { useState, type ReactNode } from "react";
import { BrainIcon, ChevronRightIcon, CircleQuestionMarkIcon, CircleXIcon, FilePenIcon, FileSearchIcon, GlobeIcon, ImageIcon, TerminalIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { useScrollLockRelease } from "../../ai-elements/conversation";
import { MessageResponse } from "../../ai-elements/message";
import { MessageRendererProvider } from "../../ai-elements/message/renderer-context";
import { Terminal, TerminalActions, TerminalContent, TerminalCopyButton, TerminalHeader, TerminalTitle } from "../../ai-elements/terminal";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "../../ui/marker";
import { SlimScroller } from "../../ui/slim-scroller";
import { cn } from "../../../lib/utils";
import { groupSummary, type ActivityTool, type GroupedToolPart } from "./groups";
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
      <MessageRendererProvider value={[]}>
        <MessageResponse>{text}</MessageResponse>
      </MessageRendererProvider>
    </SlimScroller>
  );
}

function ToolDetail({ part }: { part: ActivityTool }) {
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
        </TerminalActions>
      </TerminalHeader>
      <TerminalContent className="max-h-64 text-xs" />
    </Terminal>
  );
}

function ThoughtInline({ part }: { part: GroupedToolPart }) {
  return (
    <div className="flex min-w-0 gap-2 py-1 text-muted-foreground">
      <MarkerIcon className="mt-0.5">
        <BrainIcon />
      </MarkerIcon>
      <div className="min-w-0 flex-1 text-sm [&_[data-streamdown=strong]]:font-normal">
        <MessageRendererProvider value={[]}>
          <MessageResponse>{part.detail ?? ""}</MessageResponse>
        </MessageRendererProvider>
      </div>
    </div>
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
      <span className="flex min-w-0 items-center gap-1">
        <MarkerContent>{title}</MarkerContent>
        {open !== undefined && (
          <ChevronRightIcon
            className={cn(
              "pointer-events-none size-3 shrink-0 opacity-0 transition-[opacity,transform] group-hover/tool-toggle:opacity-100 group-focus-visible/tool-toggle:opacity-100",
              open && "rotate-90"
            )}
          />
        )}
      </span>
    </Marker>
  );
}

export function ToolRow({ part }: { part: GroupedToolPart }) {
  const [open, onOpenChange] = useFoldState();
  if (part.tool === "reasoning" && !part.merged && part.detail)
    return <ThoughtInline part={part} />;
  const row = (
    <ToolMarker
      icon={statusIcon(part)}
      open={part.detail ? open : undefined}
      title={part.title}
    />
  );
  if (!part.detail)
    return <div className="min-w-0 max-w-full py-1">{row}</div>;
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger className="group/tool-toggle flex w-full min-w-0 max-w-full cursor-pointer items-center py-1 text-left hover:[&_[data-slot=marker]]:text-foreground">
        {row}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ToolDetail part={part} />
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
  const [open, onOpenChange] = useFoldState();
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger className="group/tool-toggle flex w-full min-w-0 max-w-full cursor-pointer items-center py-1 text-left hover:[&_[data-slot=marker]]:text-foreground">
        <ToolMarker
          icon={groupIcon(parts)}
          open={open}
          title={groupSummary(parts)}
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
