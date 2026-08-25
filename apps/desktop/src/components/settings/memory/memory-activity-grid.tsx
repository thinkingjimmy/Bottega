/**
 * [INPUT]: Depends on shared MemoryStatusSnapshot, memoryActivityStats for lib/memory-view and absoluteMoment/TONE_TEXT/MemoryStat, @ai-chat/ui for cn
 * [OUTPUT]: Provides MemoryActivityGrid purely displayed components: Delivery/Call event zone + 6G counter (with hit/zero hit), two zones in equal latitude are three columns, all of which are reduced to one silent line
 * [POS]: The settings/memory run area; It is not self-contained with usage-stat-row, the same set of "big plus small tags" languages
 */

import type { MemoryStatusSnapshot } from "../../../../shared/memory-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { intlLocale } from "@/lib/i18n-locale";
import {
  TONE_TEXT,
  absoluteMoment,
  memoryActivityStats,
  type MemoryStat,
} from "@/lib/memory-view";
import { cn } from "@ai-chat/ui/lib/utils";

function StatCell({ stat, locale }: { stat: MemoryStat; locale: string }) {
  return (
    <div className="min-w-0">
      <strong
        data-testid={`memory-stat-${stat.key}`}
        data-tone={stat.tone}
        title={absoluteMoment(stat.at, locale)}
        className={cn(
          "block truncate font-heading font-semibold text-xl tracking-tight tabular-nums",
          TONE_TEXT[stat.tone]
        )}
      >
        {stat.value}
      </strong>
      <span
        title={stat.label}
        className="mt-0.5 block truncate text-muted-foreground text-xs"
      >
        {stat.label}
      </span>
    </div>
  );
}

/* ============================================================
 * 两区而非一行铺平：event 标签天生带时刻与耗时，counter 只有一个
 * 数字。并排时前者必被截断、后者空得发慌。分区之后列数固定，
 * 没有断行特例可谈——counter 恰好四格，@md 下一行到底。
 *
 * 相对时间进标签，绝对时间退到 title——审计能力不丢，注意力不散。
 * ============================================================ */

export function MemoryActivityGrid({
  status,
  now,
}: {
  status: MemoryStatusSnapshot;
  now: number;
}) {
  const { t } = useAppTranslation();
  const locale = intlLocale();
  const translate = (key: string, options?: Record<string, unknown>) =>
    t(key, options);
  const stats = memoryActivityStats(status, now, locale, translate);

  /* 「什么都还没发生」不该由六个零来宣布——一排零读起来像仪表盘坏了，
     而不像系统很闲。语气全 off 本身就是这个事实，不必再引入第二个
     谓词从快照里重新判定一遍：判据只有一处，就不会有两处各说各话。 */
  if (stats.every((stat) => stat.tone === "off")) {
    return (
      <p
        data-testid="memory-activity"
        data-empty="true"
        className="rounded-lg bg-card px-4 py-3.5 text-muted-foreground text-xs leading-relaxed ring-1 ring-foreground/10"
      >
        {t("memory.activity.empty")}
      </p>
    );
  }

  const events = stats.filter((stat) => stat.group === "event");
  const counters = stats.filter((stat) => stat.group === "counter");

  return (
    <section
      aria-label={t("memory.activity.aria")}
      data-testid="memory-activity"
      className="rounded-lg bg-card ring-1 ring-foreground/10"
    >
      {/* event 区稳定三格（交付/召回/重建后的往事），重建后成四格：
          两列时第三格独占一行、第四格再起一行，宽处白得发慌。补上
          @md 三列，两种形态都恰好铺满，不必为哪一种写特例。 */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-4 @xs:grid-cols-2 @md:grid-cols-3">
        {events.map((stat) => (
          <StatCell key={stat.key} stat={stat} locale={locale} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t p-4 @md:grid-cols-3">
        {counters.map((stat) => (
          <StatCell key={stat.key} stat={stat} locale={locale} />
        ))}
      </div>
    </section>
  );
}
