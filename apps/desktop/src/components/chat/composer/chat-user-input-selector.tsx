/**
 * [INPUT]: Depends on React question-local state, lucide icons, Chat composer/runtime i18n, ui cn/Button/SlimScroller, shared AgentUserInputQuestion and runtime pending status
 * [OUTPUT]: Provides a localized compact ChatUserInputSelector with root/Subagent sources, pending-list projection, single/multi/text/Other/Secret input, and structured runtime-error resolution
 * [POS]: Composer replacement for one pending requestUserInput event; it temporarily replaces the regular editor
 */

import { useEffect, useState } from "react";
import { CheckIcon, PenLineIcon, XIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import type { PendingUserInputState } from "../runtime/use-chat-session";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* ── 徽章律 ───────────────────────────────────────────────────
 * 徽章直径 = 它要对齐的那一行的行高。选项条是两行（标题 + 描述），
 * 徽章对齐的是标题那一行，于是 size-5 与 leading-5 是同一个 5：
 * 徽章上下沿正好扣在标题行盒上，越不进描述行。
 * 旧写法给标题外套一条 min-h-7 的基带去迁就 size-7 徽章——数学上两心
 * 重合，眼睛看到的却是徽章下沿探进描述行、上沿悬空，读成"没对齐"。
 * 兄弟卡（plan-decision size-8 / approval-card size-7）是单行条，
 * 徽章本身就是那条带，同一条律推出不同的数，不是互抄。
 * ────────────────────────────────────────────────────────── */
const BADGE = "flex size-5 shrink-0 items-center justify-center rounded-full";

/* ── 推荐后缀 ─────────────────────────────────────────────────
 * 工具协议要求把 "(Recommended)" 缀在 label 末尾，而 Agent 一说中文就写成
 * 「（推荐）」——全角括号、中文词。旧正则只认半角英文，于是中文选项的推荐
 * 标记全程失灵：抽不成徽章，也拿不到高亮底色，「（推荐）」三个字只好留在
 * 标题里当噪音。失灵是哑的——推荐项与普通项长得一模一样，没人会发现它坏了。
 *
 * 括号与词各自成组，四种组合一并收下。捕获组保留作者写的原词：中文标题配
 * 英文徽章是另一种不协调，而作者已经把该显示的词写在那里了，照抄即可。
 * ────────────────────────────────────────────────────────── */
const RECOMMENDED = /\s*[（(]\s*(recommended|推荐)\s*[)）]\s*$/i;

function optionLabel(value: string) {
  const match = RECOMMENDED.exec(value);
  return {
    label: match ? value.slice(0, match.index) : value,
    recommended: match?.[1] ?? null,
  };
}

function RecommendedTag({ word }: { word: string }) {
  return (
    <span className="inline-flex h-4 shrink-0 items-center rounded-full border bg-background px-1.5 font-medium text-[10px] text-muted-foreground">
      {word}
    </span>
  );
}

function CountdownLabel({ expiresAt }: { expiresAt: number }) {
  const { t } = useAppTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  return (
    <span className="text-xs tabular-nums">
      {t("chat.composer.userInput.countdown", { count: remaining })}
    </span>
  );
}

function SkipButton({
  busy,
  onSkip,
}: {
  busy: boolean;
  onSkip: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <Button
      className="ml-auto shrink-0 rounded-full"
      disabled={busy}
      onClick={onSkip}
      size="sm"
      type="button"
      variant="outline"
    >
      {t("chat.composer.userInput.skip")}
    </Button>
  );
}

export function ChatUserInputSelector({
  pending,
  onAnswer,
}: {
  pending: PendingUserInputState;
  onAnswer: (answers: string[]) => void;
}) {
  const question = pending.request.questions[pending.index];
  if (!question) return null;
  return (
    <ChatUserInputQuestion
      key={question.id}
      onAnswer={onAnswer}
      pending={pending}
    />
  );
}

function ChatUserInputQuestion({
  pending,
  onAnswer,
}: {
  pending: PendingUserInputState;
  onAnswer: (answers: string[]) => void;
}) {
  const { t } = useAppTranslation();
  const question = pending.request.questions[pending.index];
  const [text, setText] = useState("");
  const [other, setOther] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  if (!question) return null;
  const errorText =
    typeof pending.error === "string"
      ? pending.error
      : t(pending.error.copyKey);

  const options = question.options ?? [];
  const toggleSelected = (label: string) => {
    setSelected((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label]
    );
  };
  const submitText = () => {
    if (text.trim()) onAnswer([text.trim()]);
  };

  /* eyebrow 只陈述问题正文没说过的事实：来源、主题、队列深度。
     与正文重复的主题自动落选——ACP 里无 description 的字段，
     header 与 question 本就是同一个 property.title */
  const eyebrow = [
    pending.request.agentName ?? t("chat.composer.userInput.mainAgent"),
    question.header,
    pending.queue.length > 1
      ? t("chat.composer.userInput.pendingCount", {
          count: pending.queue.length,
        })
      : "",
  ]
    .filter((fact) => fact && fact !== question.question)
    .join(" · ");

  return (
    <section className="rounded-2xl border bg-background p-3">
      <div className="flex min-h-8 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-muted-foreground text-xs">{eyebrow}</p>
          <h2 className="pt-0.5 font-medium text-sm leading-5">
            {question.question}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {/* 只报进度不给翻页：多题是单向逐条应答，永远置灰的箭头是假承诺 */}
          {pending.request.questions.length > 1 && (
            <span className="text-xs tabular-nums">
              {t("chat.composer.userInput.progress", {
                current: pending.index + 1,
                total: pending.request.questions.length,
              })}
            </span>
          )}
          {pending.expiresAt !== undefined && (
            <CountdownLabel expiresAt={pending.expiresAt} />
          )}
          {!question.required && (
            <Button
              aria-label={t("chat.composer.userInput.skipQuestion")}
              disabled={pending.busy}
              onClick={() => onAnswer(["Skip"])}
              size="icon-sm"
              variant="ghost"
            >
              <XIcon />
            </Button>
          )}
        </div>
      </div>

      {pending.queue.length > 1 && (
        <SlimScroller
          aria-label={t("chat.composer.userInput.pendingList")}
          className="mt-2 max-h-24 space-y-1 overflow-y-auto border-t pt-2"
        >
          <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
            {t("chat.composer.userInput.pending")}
          </p>
          {pending.queue.slice(1).map((request) => (
            <div
              className="flex min-w-0 items-baseline gap-2 text-xs"
              key={request.userInputId}
            >
              <span className="shrink-0 font-medium">
                {request.agentName ?? t("chat.composer.userInput.mainAgent")}
              </span>
              <span className="truncate text-muted-foreground">
                {request.questions[0]?.question ??
                  t("chat.composer.userInput.waiting")}
              </span>
            </div>
          ))}
        </SlimScroller>
      )}

      {options.length > 0 && !other ? (
        /* 13px/20px 与 size-5 徽章是同一个决定，改一个必须改另一个 */
        <div className="mt-2 space-y-1 text-[13px] leading-5">
          {options.map((option, index) => {
            const parsed = optionLabel(option.label);
            const picked =
              question.multiSelect === true && selected.includes(option.label);
            return (
              <button
                aria-pressed={question.multiSelect ? picked : undefined}
                className={cn(
                  "grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  (picked || parsed.recommended) && "bg-muted/70"
                )}
                disabled={pending.busy}
                key={`${option.label}-${index}`}
                onClick={() =>
                  question.multiSelect
                    ? toggleSelected(option.label)
                    : onAnswer([option.label])
                }
                type="button"
              >
                {/* 徽章占 r1c1，标题占 r1c2：两者同顶同高，标题换行也拽不走它 */}
                <span
                  className={cn(
                    BADGE,
                    "border text-[11px] tabular-nums",
                    picked
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground"
                  )}
                >
                  {picked ? <CheckIcon className="size-3" /> : index + 1}
                </span>
                {/* 行尾曾有一枚 → 表示「点了就走」。它说的是真话，却说了一句
                    整行早已说过的话：整行就是 button，hover 有底色、focus 有环，
                    可点性从不含糊。而它把每一行都拉成满宽——标题短的时候，
                    标题与箭头之间裂开一片空白，选项列表读起来像一张两栏表格，
                    眼睛要横跨那片空白才够得着下一行的标题。
                    删掉之后，标题与 Recommended 徽章自然贴在一起，左边界仍由
                    徽章列钉死，一列标题于是真的成了一列。 */}
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 font-medium">{parsed.label}</span>
                  {parsed.recommended && (
                    <RecommendedTag word={parsed.recommended} />
                  )}
                </span>
                {option.description && (
                  <span className="col-start-2 text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </button>
            );
          })}
          <div className="flex items-center gap-2">
            {question.isOther && (
              <button
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={pending.busy}
                onClick={() => setOther(true)}
                type="button"
              >
                <span className={cn(BADGE, "border bg-muted/60")}>
                  <PenLineIcon className="size-3" />
                </span>
                <span className="truncate">
                  {t("chat.composer.userInput.other")}
                </span>
              </button>
            )}
            {question.multiSelect && (
              <Button
                className="ml-auto rounded-full"
                disabled={pending.busy || selected.length === 0}
                onClick={() => onAnswer(selected)}
                size="sm"
                type="button"
              >
                {t("chat.composer.userInput.confirm")}
              </Button>
            )}
            {!question.required && (
              <SkipButton
                busy={pending.busy}
                onSkip={() => onAnswer(["Skip"])}
              />
            )}
          </div>
        </div>
      ) : (
        /* pl-1.5 + gap-2.5 = 选项条的同一条左轨：切进自由输入时徽章与文字不横跳 */
        <form
          className="mt-2 flex items-center gap-2.5 pl-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submitText();
          }}
        >
          <span className={cn(BADGE, "border bg-muted/60 text-muted-foreground")}>
            <PenLineIcon className="size-3" />
          </span>
          <input
            autoFocus
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            disabled={pending.busy}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder={t("chat.composer.userInput.decisionPlaceholder")}
            type={question.isSecret ? "password" : "text"}
            value={text}
          />
          <Button
            className="rounded-full"
            disabled={pending.busy || !text.trim()}
            size="sm"
            type="submit"
          >
            {t("chat.composer.userInput.send")}
          </Button>
          {!question.required && (
            <SkipButton
              busy={pending.busy}
              onSkip={() => onAnswer(["Skip"])}
            />
          )}
        </form>
      )}

      {errorText && (
        <p className="mt-1.5 text-destructive text-xs">{errorText}</p>
      )}
    </section>
  );
}
