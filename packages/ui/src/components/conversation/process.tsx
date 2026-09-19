/**
 * [INPUT]: Depends on shared Marker/Collapsible primitives and caller-owned labels and process content.
 * [OUTPUT]: Provides ConversationAgent, ConversationProcessHeading and a collapsed process disclosure with native scroll-lock release.
 * [POS]: Shared completed-turn activity presentation; no tool execution or process decoding is owned here.
 */
import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { useScrollLockRelease } from "../ai-elements/conversation";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "../ui/marker";
import { cn } from "../../lib/utils";

export function ConversationAgent({ icon, label }: { icon: ReactNode; label: string }) {
  return <div className="mb-1 flex items-center gap-1.5 text-muted-foreground text-xs">{icon}<span>{label}</span></div>;
}

export function ConversationProcessHeading({
  label,
  open,
}: {
  label: string;
  open?: boolean;
}) {
  const collapsible = open !== undefined;
  return (
    <div className="w-full border-b pb-2">
      <Marker
        className={cn(
          "select-none",
          collapsible && "cursor-pointer hover:text-foreground",
        )}
      >
        <MarkerContent>{label}</MarkerContent>
        {collapsible && (
          <MarkerIcon>
            <ChevronRightIcon
              className={cn("transition-transform", open && "rotate-90")}
            />
          </MarkerIcon>
        )}
      </Marker>
    </div>
  );
}

export function ConversationProcess({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const stopScroll = useScrollLockRelease();
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      open={open}
      onOpenChange={(next) => {
        if (next) stopScroll();
        setOpen(next);
      }}
    >
      <CollapsibleTrigger asChild>
        <button className="w-full text-left" type="button">
          <ConversationProcessHeading label={label} open={open} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
