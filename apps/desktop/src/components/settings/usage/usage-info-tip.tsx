/**
 * [INPUT]: Depends on lucide Info icons and ui Tooltip
 * [OUTPUT]: Provides a user info tip for the user info tip; The document was entered by the caller via i18n
 * [POS]: The settings/usage sub-module is not usedshared caching tips from Est. cost and SourceRail by StatRow
 */

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";

/* ============================================================
 * 解释贴在被解释的东西旁边，页面就不需要脚注区，也就没有
 * 「脚注该显示给谁」的判断。触发器刻意用 span 而非 button：
 * 它要能安放在 TabsTrigger 内部，嵌套可交互元素是不合法的。
 * role="img" + aria-label 让读屏把全文并入宿主控件的可及名。
 * ============================================================ */

export function UsageInfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={text}
          data-testid="usage-info-tip"
          className="inline-flex shrink-0 cursor-help text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
