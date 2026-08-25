/**
 * [INPUT]: Depends on React Fragment/useState, lucide Check/ChevronRight, i18n, lib/agent-backends of AgentBackendIcon, settings-layout of SettingsList/SettingsDisclosure, ui of Button/SlimScroller, cn, shared of import preview of DTO and skill-text of SKILL_AGENTS/skillReasonText/skillSizeText/skillBytesText
 * [OUTPUT]: Provides SkillImportPanel/SkillImporting The permanent entry area of the library: four source rows to open the candidate table, to capture the entire list, to provide full text with the instructions, to sort in non-imported categories, to submit single and non-card "all imported" items; the pressed import button carries its own in-flight spinner (`importing`)
 * [POS]: Settings › Skills is the only surface in the library; The first step is where Ku-Ka-Ka lives, and the second step is where the Import, a subset of the two, is located
 */

import { Fragment, useState } from "react";
import { Check, ChevronRight, LoaderCircle } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentBackendIcon } from "@/lib/agent-backends";
import {
  SettingsDisclosure,
  SettingsList,
} from "@/components/settings/settings-layout";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  SKILL_AGENTS,
  skillBytesText,
  skillReasonText,
  skillSizeText,
} from "./skill-text";
import type {
  ManagedSkillAgent,
  ManagedSkillImportPreview,
} from "../../../../shared/unified-skills-ipc";

export type SkillImportResult = Readonly<{ imported: number; skipped: number }>;
/* 哪一颗导入键正在干活。busy 禁住一切，spinner 只落在被按下的那一颗上——
   「界面上没有任何动静」正是二次点击与并发提交的温床。 */
export type SkillImporting = "selected" | "all" | null;

/* ── 表面只留两色 ──────────────────────────────────────────────────
 * 白 = 卡片与收起的行；灰 = 「这一家开着」的一整块（行 + 吸顶表头 +
 * 候选 + 动作条）。一种灰，一个意思。
 *
 * 吸顶表头必须不透明，否则行会从它底下透出来滚过去——这是它当初写死
 * bg-card 的真实理由，那会儿列表本来就是白的。列表搬进带底色的展开区
 * 之后那个前提没了，白就成了全场唯一一块白。所以它跟着容器走 bg-muted：
 * 「必须不透明」与「必须是白的」从来不是同一件事。
 * ──────────────────────────────────────────────────────────────── */
const SHEET = "bg-muted";

export function SkillImportPanel({
  counts,
  bytes,
  preview,
  openAgent,
  selected,
  busy,
  importing,
  result,
  onOpen,
  onSelected,
  onImport,
  onImportAll,
}: {
  counts: Readonly<Record<ManagedSkillAgent, number>>;
  bytes: number;
  preview: ManagedSkillImportPreview | null;
  openAgent: ManagedSkillAgent | null;
  selected: Set<string>;
  busy: boolean;
  importing: SkillImporting;
  result: SkillImportResult | null;
  onOpen(agent: ManagedSkillAgent | null): void;
  onSelected(next: Set<string>): void;
  onImport(): void;
  onImportAll(): void;
}) {
  const { t } = useAppTranslation();
  const total = SKILL_AGENTS.reduce((sum, agent) => sum + counts[agent], 0);

  return (
    <div>
      {/* 结果条讲的是「刚发生了什么」，先读到才有用，所以在卡片上方；
          它与「全部导入」一样不是卡片的成员，所以都不进卡片。 */}
      {result && <ImportResult result={result} />}

      {/* 四家一律有行，包括零存量的那几家：行本身就是目标，一行 0 是个
          诚实的事实，摊开才比得了「东西都在哪儿」。
          顺序钉死在 SKILL_AGENTS，不按存量排——每导一批存量就变，
          按存量排等于让行在光标底下重新洗牌。 */}
      <SettingsList>
        {SKILL_AGENTS.map((agent) => (
          <Fragment key={agent}>
            <SourceRow
              agent={agent}
              busy={busy}
              count={counts[agent]}
              open={openAgent === agent}
              onOpen={onOpen}
            />
            {openAgent === agent && (
              <CandidateSheet
                agent={agent}
                busy={busy}
                importing={importing}
                onImport={onImport}
                onSelected={onSelected}
                preview={preview}
                selected={selected}
              />
            )}
          </Fragment>
        ))}
      </SettingsList>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between gap-5">
          <p className="text-xs leading-relaxed">
            {t("settings.skills.importAllFact", { count: total, size: skillBytesText(bytes) })}
          </p>
          <Button className="shrink-0" disabled={busy} onClick={onImportAll} size="pill">
            {importing === "all" && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {t("settings.skills.importAll", { count: total })}
          </Button>
        </div>
      )}
    </div>
  );
}

function ImportResult({ result }: { result: SkillImportResult }) {
  const { t } = useAppTranslation();
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg bg-muted px-3.5 py-2.5" role="status">
      <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <p className="text-xs leading-relaxed">
        {t("settings.skills.importResult", { count: result.imported })}
        {result.skipped > 0 && ` ${t("settings.skills.importSkipped", { count: result.skipped })}`}
      </p>
    </div>
  );
}

/* ── 整行即目标，chevron 转 90° ──────────────────────────────────
 * 从前这枚 chevron 刻意不旋转，注释说它表示「去别处」——可它去的是一个
 * 把「哪一家」原样又问一遍的弹窗，那一下等于没做出任何选择。现在它就地
 * 展开，于是转，与库行同一副语汇：转 = 就地展开。
 * 行上没有一个字说「展开」，所以 aria-label 把整句话补齐。
 * ──────────────────────────────────────────────────────────────── */
function SourceRow({
  agent,
  count,
  open,
  busy,
  onOpen,
}: {
  agent: ManagedSkillAgent;
  count: number;
  open: boolean;
  busy: boolean;
  onOpen(agent: ManagedSkillAgent | null): void;
}) {
  const { t } = useAppTranslation();
  const name = t(`settings.skills.backend.${agent}`);
  return (
    <button
      aria-expanded={count > 0 ? open : undefined}
      aria-label={count > 0
        ? t(open ? "settings.skills.sourceCollapse" : "settings.skills.sourceExpand", { agent: name })
        : undefined}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-55 motion-reduce:transition-none",
        open ? SHEET : "hover:bg-muted/60"
      )}
      disabled={busy || count === 0}
      onClick={() => onOpen(open ? null : agent)}
      type="button"
    >
      <AgentBackendIcon backend={agent} className="size-4" />
      <span className="w-[5.5rem] shrink-0 font-medium text-sm">{name}</span>
      <span className="truncate text-muted-foreground text-xs">
        {t("settings.skills.sourceFound", { count })}
      </span>
      {count > 0 && (
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "ml-auto size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90"
          )}
        />
      )}
    </button>
  );
}

function CandidateSheet({
  agent,
  preview,
  selected,
  busy,
  importing,
  onSelected,
  onImport,
}: {
  agent: ManagedSkillAgent;
  preview: ManagedSkillImportPreview | null;
  selected: Set<string>;
  busy: boolean;
  importing: SkillImporting;
  onSelected(next: Set<string>): void;
  onImport(): void;
}) {
  const { t } = useAppTranslation();
  /* 指令全文一次只开一条：每行常驻一个折叠器等于几十个控件，
     而读全文是偶发动作，不是每行的常态。 */
  const [openRef, setOpenRef] = useState<string | null>(null);
  const ready = preview?.source === agent ? preview : null;
  const importable = ready?.candidates.filter((item) => item.importable) ?? [];
  const blocked = ready?.candidates.filter((item) => !item.importable) ?? [];
  const all = importable.length > 0 && selected.size >= importable.length;

  const toggle = (ref: string) => {
    const next = new Set(selected);
    if (next.has(ref)) next.delete(ref); else next.add(ref);
    onSelected(next);
  };

  return (
    <div className={SHEET}>
      {/* 列表框贴着内容长（max-h 封顶）：Kimi 只有一条时若让它硬撑到 384px，
          一个空白框读起来像坏了。多出来的空间落在框外面，那才叫「就这么多」。 */}
      <SlimScroller className="max-h-96 overflow-y-auto">
        {importable.length > 0 && (
          <div className={cn("sticky top-0 z-10 flex items-center gap-2.5 border-border border-b px-3.5 py-2", SHEET)}>
            <input
              aria-label={t("settings.skills.toggleAll")}
              checked={all}
              className="size-4 shrink-0 accent-foreground"
              disabled={busy}
              onChange={() => onSelected(all ? new Set() : new Set(importable.map((item) => item.ref)))}
              ref={(node) => { if (node) node.indeterminate = selected.size > 0 && !all; }}
              type="checkbox"
            />
            <span className="font-medium text-muted-foreground text-xs tabular-nums">
              {t("settings.skills.selectedCount", { selected: selected.size, total: importable.length })}
            </span>
          </div>
        )}

        {importable.map((candidate, index) => {
          const open = openRef === candidate.ref;
          return (
            /* 首行不描上边：表头已经有下边框，`first:` 现在指的是表头不是它。 */
            <div className={cn(index > 0 && "border-border border-t")} key={candidate.ref}>
              <div className="flex items-start gap-2.5 px-3.5 py-2.5">
                <input
                  aria-label={candidate.displayName}
                  checked={selected.has(candidate.ref)}
                  className="mt-1 size-4 shrink-0 accent-foreground"
                  disabled={busy}
                  onChange={() => toggle(candidate.ref)}
                  type="checkbox"
                />
                {/* 勾选与「看全文」是两件事，就给两个靶子：复选框只管选，
                    行体展开指令。 */}
                <button
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  onClick={() => setOpenRef(open ? null : candidate.ref)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-3">
                      <span className="font-medium text-sm">{candidate.displayName}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {skillSizeText(t, candidate.files, candidate.bytes)}
                      </span>
                    </span>
                    {/* 触发词清单动辄十几行；两行足够认出它是什么。
                        这里刻意不写 `block`——`line-clamp-2` 靠的正是
                        `display:-webkit-box`，两条同时在，截断就是死的。 */}
                    <span className="mt-0.5 line-clamp-2 text-muted-foreground text-xs leading-relaxed">
                      {candidate.description}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className={cn("mt-1.5 size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90")}
                  />
                </button>
              </div>
              {open && (
                <pre className="mr-3.5 mb-2.5 ml-[42px] max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-[11px] leading-relaxed">
                  {candidate.preview}
                </pre>
              )}
            </div>
          );
        })}

        {ready && !importable.length && (
          <p className="px-3.5 py-6 text-center text-muted-foreground text-sm">
            {t("settings.skills.noCandidates")}
          </p>
        )}

        {/* 收不进来的东西停在列表末尾：它们不是候选，混排只会让人反复
            去点一颗永远点不动的复选框。跨四家同名也落在这里——它是一个
            理由码，不是一张新界面。 */}
        {blocked.length > 0 && (
          <div className="border-border border-t px-3.5 py-2.5">
            <SettingsDisclosure label={t("settings.skills.blocked", { count: blocked.length })}>
              <ul className="space-y-1">
                {blocked.map((candidate) => (
                  <li className="text-[11px] text-muted-foreground leading-relaxed" key={candidate.ref}>
                    <span className="text-foreground">{candidate.displayName}</span>
                    {" · "}
                    {candidate.reason ? t("settings.skills.notImportable", { reason: skillReasonText(t, candidate.reason) }) : null}
                  </li>
                ))}
              </ul>
            </SettingsDisclosure>
          </div>
        )}
      </SlimScroller>

      {/* 动作待在它所作用之物的脚下。这条管这一家的勾选，卡片外那条管全部四家。 */}
      {importable.length > 0 && (
        <div className={cn("flex items-center justify-between gap-5 border-border border-t px-3.5 py-1.5", SHEET)}>
          <p className="max-w-[52ch] text-[11px] text-muted-foreground leading-relaxed">
            {t("settings.skills.importHint", { agent: t(`settings.skills.backend.${agent}`) })}
          </p>
          <Button className="shrink-0" disabled={busy || !selected.size} onClick={onImport} size="pill">
            {importing === "selected" && <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            {t("settings.skills.importSelected", { count: selected.size })}
          </Button>
        </div>
      )}
    </div>
  );
}
