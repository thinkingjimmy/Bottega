/**
 * [INPUT]: Depends on lucide TriangleAlert Icon, UI Button and ai-elements MessageResponse
 * [OUTPUT]: Provides TurnErrorCard: Alarm icon + destructive title + regular colored font + built-in "continue" failed card
 * [POS]: The common default filters for chat/transcript are similar to chat-usage-limit-card; Selected by ChatTurn in isError and Unlimited Streams
 */

import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { MessageResponse } from "@ai-chat/ui/components/ai-elements/message";

/* ── 告警不是「把整块染红」，是「说清哪儿错了」 ────────────────────
 * 从前它借 MessageContent 加一圈 destructive 类。可 MessageContent 的
 * 圆角与内边距只对 user 气泡生效，assistant 侧一律为零——于是错误成了
 * 一条直角、贴边、通体全红的横杠：像被样式误伤的段落，不像一张卡片。
 *
 * 三处校正，方向只有一个——恢复层级：
 *   形状 · 与限流卡同族的 rounded-xl + 内边距，它才像个可读的容器；
 *   图标 · 与侧栏失败态同一个 TriangleAlert，同一件事在两处同一副面孔；
 *   配色 · 红只留给标题。正文本就该被读懂，通体全红时没有任何东西被强调。
 *
 * 标题的红不靠切字符串取——`**Agent 错误：**` 落到 DOM 里本就是一个粗体节点，
 * 认这个结构即可。视图不去解析数据的措辞，改文案时也就没有东西会碎。
 * 认的是 `data-streamdown="strong"` 而非 `<strong>`：streamdown 把粗体渲染成
 * 带该属性的 span，追 tag 名会静默落空（本文件同族的链接光标锁定同理，
 * 见 ai-elements/message.tsx）——属性是它给出的稳定契约，tag 名不是。
 * ────────────────────────────────────────────────────────────── */

export function TurnErrorCard({
  content,
  onContinue,
}: {
  content: string;
  /** 「继续」只在失败 turn 成立，故它长在卡片里，与限流卡的「立即重试」同位 */
  onContinue?: () => void;
}) {
  return (
    <div
      className="flex w-full min-w-0 max-w-full gap-2.5 overflow-hidden rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3"
      role="alert"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <MessageResponse className="text-sm [&_[data-streamdown=strong]]:text-destructive">
          {content}
        </MessageResponse>
        {onContinue && (
          <Button
            onClick={onContinue}
            size="sm"
            type="button"
            variant="outline"
          >
            继续
          </Button>
        )}
      </div>
    </div>
  );
}
