/**
 * [INPUT]: The onboarding step, i18n (common/projects labels and onboarding.preview demo copy), AgentBackendIcon and lucide icons.
 * [OUTPUT]: OnboardingPreview — an inert, static Bottega window (sidebar, open Chat with Plan, composer) drawn to the website hero's geometry; the Agent step zooms the camera onto the sidebar, where every Chat shows its Agent.
 * [POS]: Decorative right half of OnboardingFrame; it reads no product state, so onboarding never waits on or touches the real workspace.
 */
import { ArrowUp, Bell, ChevronDown, ChevronRight, Copy, Folder, LayoutGrid, Lightbulb, Maximize2, PanelRight, Plus, Search, Settings, SquarePen } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { AgentBackendIcon, backendLabel } from "@/lib/agent/agent-backends";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import type { OnboardingStep } from "../plan";

type ChatId = "releaseNotes" | "settingsPanel" | "changelog" | "importTests" | "onboarding" | "iconGrid" | "acp";
/* Agent order follows the website's demo: four Agents, each visible at the head of its Chat. */
const PROJECT_CHATS: ReadonlyArray<[ChatId, AgentBackendId]> = [
  ["releaseNotes", "codex"], ["settingsPanel", "claude"], ["changelog", "kimi"], ["importTests", "opencode"], ["onboarding", "codex"],
];
const LOOSE_CHATS: ReadonlyArray<[ChatId, AgentBackendId]> = [["iconGrid", "codex"], ["acp", "claude"]];

function Row({ mark, title, sub, on, dim, spot }: { mark: ReactNode; title: string; sub?: boolean; on?: boolean; dim?: boolean; spot?: number }) {
  return <div className="op-row" data-sub={sub || undefined} data-on={on || undefined} data-dim={dim || undefined}
    data-spot={spot === undefined ? undefined : ""} style={spot === undefined ? undefined : { "--spot": spot } as CSSProperties}>
    <span className="op-mark">{mark}</span><span className="op-title">{title}</span>
  </div>;
}

/** Inline `code` spans, as the product transcript renders them. */
const Rich = ({ text }: { text: string }) => <>{text.split("`").map((part, at) => at % 2 ? <code key={at}>{part}</code> : part)}</>;

export function OnboardingPreview({ step }: { step: OnboardingStep }) {
  const { t } = useAppTranslation();
  const chat = (id: ChatId) => t(`onboarding.preview.chats.${id}`);
  const icon = "size-4";
  let spot = 0;
  return <div aria-hidden="true" inert className="onboarding-preview" data-step={step}>
    <div className="op-window">
      <aside className="op-side">
        <div className="op-traffic"><i /><i /><i /><PanelRight className={icon} strokeWidth={1.5} /></div>
        <div className="op-brand"><b>{PRODUCT_NAME}</b><Search className={icon} /><Bell className={icon} /></div>
        <div className="op-group">
          <Row mark={<SquarePen className={icon} />} title={t("common.newChat")} />
          <Row mark={<LayoutGrid className={icon} />} title={t("common.apps")} />
        </div>
        <div className="op-scroll">
          <p className="op-label">{t("common.projects")}</p>
          <Row mark={<Folder className={icon} />} title={t("onboarding.preview.project")} />
          {PROJECT_CHATS.map(([id, agent], at) =>
            <Row key={id} sub on={at === 0} spot={spot++} mark={<AgentBackendIcon backend={agent} className="size-3.5" />} title={chat(id)} />)}
          <Row sub dim mark={<ChevronDown className={icon} />} title={t("projects.showMore")} />
          <p className="op-label">{t("common.chats")}</p>
          {LOOSE_CHATS.map(([id, agent]) =>
            <Row key={id} spot={spot++} mark={<AgentBackendIcon backend={agent} className="size-3.5" />} title={chat(id)} />)}
        </div>
        <div className="op-group op-foot"><Row mark={<Settings className={icon} />} title={t("common.settings")} /></div>
      </aside>

      <div className="op-main">
        <div className="op-head"><AgentBackendIcon backend="codex" className="size-4" /><span>{chat("releaseNotes")}</span><PanelRight className={`${icon} ml-auto`} strokeWidth={1.5} /></div>
        <div className="op-chat">
          <div className="op-bubble">{t("onboarding.preview.priorAsk")}</div>
          <div className="op-worked">{t("onboarding.preview.workedFor", { duration: "22s" })}<ChevronRight className={icon} /></div>
          <p className="op-reply">{t("onboarding.preview.priorReply")}</p>
          <div className="op-bubble">{t("onboarding.preview.ask")}</div>
          <div className="op-worked">{t("onboarding.preview.workedFor", { duration: "1m 12s" })}<ChevronRight className={icon} /></div>
          <section className="op-plan">
            <div className="op-plan-head"><Lightbulb className={icon} /><span>{t("onboarding.preview.plan")}</span><span className="ml-auto flex gap-3"><Copy className={icon} /><Maximize2 className={icon} /></span></div>
            <div className="op-plan-body">
              <h3>{t("onboarding.preview.planTitle")}</h3>
              <h4>{t("onboarding.preview.summary")}</h4>
              <ul><li><Rich text={t("onboarding.preview.summaryFirst")} /></li><li><Rich text={t("onboarding.preview.summarySecond")} /></li></ul>
              <div className="op-fade" />
            </div>
          </section>
          <div className="op-status"><span className="op-orb" /><span className="op-shimmer">{t("onboarding.preview.status")}</span></div>
        </div>
        <div className="op-composer">
          <div className="op-field">{t("onboarding.preview.askAnything")}</div>
          <div className="op-tools">
            <span className="op-tool"><Plus className={icon} /></span>
            <span className="op-tool ml-auto text-foreground"><AgentBackendIcon backend="codex" className="size-4" />{backendLabel("codex")}</span>
            <span className="op-tool">{t("onboarding.preview.model")}</span>
            <span className="op-send"><ArrowUp className="size-3.5" /></span>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
