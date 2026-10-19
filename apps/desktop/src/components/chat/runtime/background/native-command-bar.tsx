/**
 * [INPUT]: Uses the shared Chat-scoped native command runtime, ComposerContext, theme tokens and localized service controls.
 * [OUTPUT]: Exports NativeCommandBar, an attached service shelf with exact-item Stop and no disclosure interaction.
 * [POS]: Composer presentation of existing native background commands; output stays in the original transcript detail.
 */
import { SquareIcon } from "lucide-react";
import { ComposerContext } from "@ai-chat/chat-ui/composer";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useNativeCommands } from "./native-command-runtime";

export function NativeCommandBar() {
  const { commands, stop } = useNativeCommands();
  const { t } = useAppTranslation();
  if (!commands.length) return null;
  return <ComposerContext className="flex-col items-stretch gap-0" role="group" aria-label={t("chat.nativeBackground.services")} data-native-background>
    {commands.map(command => {
      const stopping = command.status === "stopping", failed = command.status === "failed";
      const status = t(stopping ? "chat.nativeBackground.stopping" : failed ? "chat.nativeBackground.stopFailed" : "chat.nativeBackground.running");
      return <div key={command.itemId} data-native-service={command.itemId} className="border-border/60 border-t first:border-t-0">
        <div className="flex min-h-11 items-center gap-2 px-2 text-xs">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-destructive" : stopping ? "bg-amber-500" : "bg-emerald-600 dark:bg-emerald-400")} />
          <span className="min-w-0 truncate" title={command.command}>{command.command}</span>
          <span className={cn("mr-auto shrink-0 text-muted-foreground", failed && "text-destructive")} role="status">· {status}</span>
          <Button type="button" size="sm" variant="ghost" className="relative shrink-0 touch-target-44 gap-1.5 px-2 text-xs" data-native-command={command.itemId}
            aria-label={t(failed ? "chat.nativeBackground.retryNamed" : "chat.nativeBackground.stopNamed", { name: command.command })}
            disabled={stopping} onClick={() => void stop(command)}>
            <SquareIcon className="size-3" />{t(stopping ? "chat.nativeBackground.stopping" : failed ? "chat.nativeBackground.retry" : "chat.nativeBackground.stop")}
          </Button>
        </div>
        {failed && <p role="alert" className="px-5 pb-2 text-destructive text-xs">{t("chat.nativeBackground.failed")}</p>}
      </div>;
    })}
  </ComposerContext>;
}
