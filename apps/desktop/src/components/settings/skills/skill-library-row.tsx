/**
 * [INPUT]: Depends on React useState/useId, lucide ChevronRight, i18n, lib/agent-backends for AgentBackendIcon, settings-layout for SettingsSwitch, ui/Button, cn, shared for library entries/goals/four layers DTO and skillPillView for skill-text
 * [OUTPUT]: Provides SkillLibraryRow: four state points of Skill in a row, and then deployed by Agent to give four layers, visibility, and the only action with the Codex dialog file
 * [POS]: The only implementation of the Settings › Skills library list is the following: The scan and diagnosis are folded on both sides, with four layers only in the open area
 */

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { SettingsSwitch } from "@/components/settings/settings-layout";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import { skillPillView, type SkillPillView } from "./skill-text";
import type {
  ManagedSkillAction,
  ManagedSkillLayerState,
  ManagedSkillLibraryItem,
  ManagedSkillTargetView,
} from "../../../../shared/unified-skills-ipc";

/* ── 四档色 ────────────────────────────────────────────────────────
 * 只有 warn 该抢眼：它是唯一需要人现在就处置的状态。其余三档靠
 * 「有没有底色」与「点是实心、空心环还是虚线」区分——同时给形与色两个
 * 通道，色觉受限的人不至于只剩一个通道可读。
 * ──────────────────────────────────────────────────────────────── */
const PILL_TONE: Record<SkillPillView["tone"], string> = {
  on: "bg-muted text-foreground",
  muted: "border border-border text-muted-foreground",
  off: "border border-dashed border-border text-muted-foreground",
  warn: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
};

const DOT_TONE: Record<SkillPillView["tone"], string> = {
  on: "bg-foreground",
  muted: "border-2 border-muted-foreground/70",
  off: "border border-muted-foreground/45",
  warn: "bg-amber-500",
};

export function SkillLibraryRow({
  skill,
  busy,
  onAction,
  onProduct,
}: {
  skill: ManagedSkillLibraryItem;
  busy: boolean;
  onAction(skill: ManagedSkillLibraryItem, target: ManagedSkillTargetView, action: ManagedSkillAction): void;
  onProduct(skill: ManagedSkillLibraryItem, enabled: boolean): void;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <article>
      {/* 整行是命中区：名字、说明与那排点讲的是同一件事，
          只让箭头可点等于把「可读的」和「可点的」割成两块。 */}
      <button
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={t(open ? "settings.skills.collapse" : "settings.skills.expand", { name: skill.displayName })}
        className="flex w-full min-h-11 cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
        onClick={() => setOpen((current) => !current)}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-sm">{skill.displayName}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {t("settings.skills.source", { source: skill.source.label, generation: skill.source.generation })}
            </span>
          </div>
          <p className="line-clamp-1 text-muted-foreground text-xs leading-relaxed">{skill.description}</p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {skill.targets.map((target) => (
              <StatePill key={target.agent} target={target} />
            ))}
          </div>
        </div>
        <ChevronRight
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90")}
        />
      </button>

      {open && (
        <div className="border-border border-t bg-muted/25" id={panelId}>
          {skill.targets.map((target) => (
            <AgentDetail
              busy={busy}
              key={target.agent}
              onAction={onAction}
              onProduct={onProduct}
              skill={skill}
              target={target}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function StatePill({ target }: { target: ManagedSkillTargetView }) {
  const { t } = useAppTranslation();
  const view = skillPillView(target.state);
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] leading-none", PILL_TONE[view.tone])}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[view.tone])} />
      {t(`settings.skills.backend.${target.agent}`)}
      {view.note && <span className="opacity-75">· {t(`settings.skills.pill.${view.note}`)}</span>}
      {/* 点与词只对眼睛说话；读屏用户拿到的是同一句判决的完整版本。 */}
      <span className="sr-only">: {t(`settings.skills.ownership.${target.state.ownership}`)}</span>
    </span>
  );
}

function AgentDetail({
  skill,
  target,
  busy,
  onAction,
  onProduct,
}: {
  skill: ManagedSkillLibraryItem;
  target: ManagedSkillTargetView;
  busy: boolean;
  onAction(skill: ManagedSkillLibraryItem, target: ManagedSkillTargetView, action: ManagedSkillAction): void;
  onProduct(skill: ManagedSkillLibraryItem, enabled: boolean): void;
}) {
  const { t } = useAppTranslation();
  const action = actionFor(target.state);
  const foreign = target.state.ownership === "foreign";
  const blocked = foreign && target.state.recovery !== "ready";
  const agentName = t(`settings.skills.backend.${target.agent}`);

  return (
    <section
      aria-label={`${skill.displayName} ${agentName}`}
      className="grid gap-3 border-border border-t px-4 py-3 first:border-t-0 @md:grid-cols-[6.5rem_minmax(0,1fr)_auto]"
    >
      <p className="flex items-center gap-1.5 font-medium text-xs">
        <AgentBackendIcon backend={target.agent} className="size-3.5" />
        {agentName}
      </p>

      <div className="min-w-0 space-y-1.5">
        <p className={cn("font-medium text-xs", foreign && "text-amber-700 dark:text-amber-300", target.state.ownership === "absent" && "text-muted-foreground")}>
          {t(`settings.skills.ownership.${target.state.ownership}`)}
        </p>

        {/* 一条状态最多配一句解释，而且只在解释真的存在时才占位。 */}
        {target.state.ownership === "imported-source" && (
          <p className="max-w-[46ch] text-[11px] text-muted-foreground leading-relaxed">
            {t("settings.skills.importedSourceHint", { agent: agentName })}
          </p>
        )}
        {target.state.recovery === "move-foreign-target" && (
          <p className="max-w-[46ch] text-[11px] text-amber-700 leading-relaxed dark:text-amber-300">{t("settings.skills.recoveryMoveForeign")}</p>
        )}
        {foreign && target.state.recovery === "none" && (
          <p className="max-w-[46ch] text-[11px] text-amber-700 leading-relaxed dark:text-amber-300">{t("settings.skills.recoveryUnavailable")}</p>
        )}
        {target.deprecated && <p className="text-[11px] text-muted-foreground">{t("settings.skills.targetDeprecated")}</p>}

        <LayerLine state={target.state} />

        <p className="text-[11px] text-muted-foreground">
          {t("settings.skills.visibility", {
            agents: target.visibleTo
              .map((item) => `${t(`settings.skills.backend.${item.agent}`)} (${t(`settings.skills.surface.${item.surface}`)})`)
              .join(", "),
          })}
        </p>

        {target.agent === "codex" && typeof target.state.productEnabled === "boolean" && target.state.present && (
          <div className="flex min-h-11 items-center gap-3">
            <SettingsSwitch
              checked={target.state.productEnabled}
              disabled={busy}
              id={`product-${skill.ref}`}
              label={`${skill.displayName}: ${t("settings.skills.productToggle")}`}
              onToggle={(enabled) => onProduct(skill, enabled)}
            />
            <label className="text-[11px]" htmlFor={`product-${skill.ref}`}>{t("settings.skills.productToggle")}</label>
          </div>
        )}
      </div>

      <Button
        className="justify-self-start @md:justify-self-end"
        disabled={busy || blocked}
        onClick={() => onAction(skill, target, action)}
        size="pill"
        variant={action === "remove" ? "destructive" : action === "takeover" ? "default" : "outline"}
      >
        {t(`settings.skills.action.${action}`)}
      </Button>
    </section>
  );
}

function LayerLine({ state }: { state: ManagedSkillLayerState }) {
  const { t } = useAppTranslation();
  const rows = [
    ["present", state.present], ["native", state.nativeEnabled],
    ["product", state.productEnabled], ["session", state.sessionVisible],
  ] as const;
  return (
    <dl className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
      {rows.map(([label, value]) => (
        <div className="flex gap-1" key={label}>
          <dt>{t(`settings.skills.layers.${label}`)}</dt>
          <dd className={cn(value === true && "text-foreground")}>{layerValue(value, t)}</dd>
        </div>
      ))}
    </dl>
  );
}

function actionFor(state: ManagedSkillLayerState): ManagedSkillAction {
  if (state.ownership === "managed-projection") return "remove";
  if (state.ownership === "imported-source") return "takeover";
  if (state.ownership === "foreign") return "recover";
  return "project";
}

function layerValue(value: boolean | "unknown" | "not-applicable", t: (key: string) => string) {
  if (value === "unknown") return t("settings.skills.layers.unknown");
  if (value === "not-applicable") return t("settings.skills.layers.na");
  return t(value ? "settings.skills.layers.yes" : "settings.skills.layers.no");
}
