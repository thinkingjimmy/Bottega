/**
 * [INPUT]: Depends on React ReactNode, lucide ChevronRight, i18n, ui/Button, cn
 * [OUTPUT]: Provides SkillFirstRun ((three process lines, the body is input by the caller in step 1) with SkillUnmanagedNotice ((a line of hints when the library is empty and closed to the library))
 * [POS]: The process page for Settings › Skills; The repository itself lives in the skill-import-panel, where it is only responsible for "where it hangs below"
 */

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";

const STEPS = ["import", "project", "session"] as const;

/* ── 三步不等重，就别画成三张等重的卡 ──────────────────────────────
 * 从前这里是并排三张同底色的卡：第 1 步是此刻就要做的事，2、3 是以后
 * 按 Skill 反复发生的事，三者被画成同一分量，于是「现在该干嘛」得自己
 * 从里面找。改成一条竖线串起来之后，只有第 1 步带表面，2、3 退成同一
 * 条线上的安静预告——顺序本身成了版面。
 *
 * 编号也一并去掉：数字加竖线读起来像「走完就结束的向导」，而 2、3 是
 * 生命周期里反复发生的阶段，`per Skill` 那枚小标就是为纠正这个而写。
 * ──────────────────────────────────────────────────────────────── */
export function SkillFirstRun({ children }: { children: ReactNode }) {
  const { t } = useAppTranslation();

  return (
    <ol className="space-y-4">
      {STEPS.map((step, index) => (
        <li className="relative flex gap-3" key={step}>
          {/* 线段挂在每一步（末步除外）而不是整块容器上：容器要靠
              top/bottom 猜出最后一颗点的位置，内容一改就露馅；挂在步上
              只需向下探进 space-y-4 的那道缝，与内容高度无关。 */}
          {index < STEPS.length - 1 && (
            <span aria-hidden="true" className="-bottom-4 absolute top-4 left-[6.5px] w-px bg-border" />
          )}
          <span
            aria-hidden="true"
            className="relative z-[1] mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-background"
          >
            <span className={cn("size-2 rounded-full", index === 0 ? "bg-foreground" : "ring-1 ring-foreground/28 ring-inset")} />
          </span>

          <div className="min-w-0 flex-1">
            <p className={cn("text-[13px]/[18px]", index === 0 ? "font-heading font-semibold" : "font-medium text-muted-foreground")}>
              {t(`settings.skills.step.${step}Title`)}
              {index > 0 && (
                <span className="ml-2 font-normal text-[11px] text-muted-foreground/85">
                  {t("settings.skills.stepPerSkill")}
                </span>
              )}
            </p>
            <p className="mt-1 max-w-[62ch] text-pretty text-muted-foreground text-xs leading-relaxed">
              {t(`settings.skills.step.${step}Detail`)}
            </p>
            {index === 0 && <div className="mt-2.5">{children}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── 库非空时，未纳管是机会不是过错 ────────────────────────────────
 * 从前它是一整块琥珀告警，占掉首屏第一眼；而它陈述的只是
 * 「你还有东西可以搬进来」。中性表面把它降回它本来的分量，
 * Codex 预算那句仍然只在 codex 真有存量时才出现——不替官方补因果。
 *
 * 入库面开着的时候它自己收起：那时候它要说的话，那块面正在做。
 * ──────────────────────────────────────────────────────────────── */
export function SkillUnmanagedNotice({
  total,
  codexUnmanaged,
  busy,
  onReview,
  onDismiss,
}: {
  total: number;
  codexUnmanaged: number;
  busy: boolean;
  onReview(): void;
  onDismiss(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="rounded-lg bg-muted px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed">{t("settings.skills.unmanagedNotice", { count: total })}</p>
        <div className="flex items-center gap-2">
          <Button disabled={busy} onClick={onReview} size="pill" variant="outline">
            {t("settings.skills.review", { count: total })}
            <ChevronRight />
          </Button>
          <Button disabled={busy} onClick={onDismiss} size="pill" variant="ghost">
            {t("settings.skills.dismiss")}
          </Button>
        </div>
      </div>
      {codexUnmanaged > 0 && (
        <p className="mt-1.5 max-w-[72ch] text-[11px] text-muted-foreground leading-relaxed">{t("settings.skills.codexBudget")}</p>
      )}
    </div>
  );
}
