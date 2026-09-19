/**
 * [INPUT]: Depends on shared Skeleton/theme primitives and a host-provided accessible loading label.
 * [OUTPUT]: Provides stable user/assistant placeholders using the real conversation column's density.
 * [POS]: Shared conversation loading presentation; hosts retain their header, composer and scroll ownership.
 */
import { Fragment } from "react";
import { Skeleton } from "../ui/skeleton";
/* Two exchanges is enough to read as "a conversation is coming". Widths are
   fixed so the block never twitches, and uneven so it reads as speech rather
   than as a progress bar. */
const EXCHANGES = [
  { prompt: "46%", reply: ["96%", "88%", "62%"] },
  { prompt: "34%", reply: ["92%", "70%"] },
] as const;

export function ConversationSkeleton({ label, align = "bottom" }: { label: string; align?: "bottom" | "top" }) {
  return (
    <div
      aria-busy="true"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-transcript-skeleton=""
      data-slot="conversation-skeleton"
      aria-label={label}
      role="status"
    >
      <span className="sr-only">{label}</span>
      {/* mt-auto keeps the placeholder against the bottom edge, where a hydrated
          transcript parks its latest turn: the arriving messages replace it in
          place instead of sliding up from the top. */}
      <div className={`mx-auto ${align === "bottom" ? "mt-auto" : ""} flex w-full min-w-0 max-w-3xl flex-col gap-6 p-4`}>
        {EXCHANGES.map((exchange, index) => (
          <Fragment key={index}>
            <div className="flex justify-end">
              <Skeleton
                className="h-10 rounded-lg motion-reduce:animate-none"
                style={{ width: exchange.prompt }}
              />
            </div>
            <div className="flex flex-col gap-2">
              {exchange.reply.map((width) => (
                <Skeleton
                  className="h-4 motion-reduce:animate-none"
                  key={width}
                  style={{ width }}
                />
              ))}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
