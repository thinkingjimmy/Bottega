/**
 * [INPUT]: Bundled, trusted Agent logo markup and React.
 * [OUTPUT]: Shared backendLabel, AgentBackendIcon, AgentBackendId and AgentIconTone.
 * [POS]: Shared Agent identity independent of native availability policy.
 */
import { createElement, type ComponentProps } from "react";
import { AGENT_LOGO_MARKUP } from "../../../../model-logos/inline";
export type AgentBackendId = keyof typeof AGENT_LOGO_MARKUP;
const labels: Record<AgentBackendId, string> = { codex: "Codex", claude: "Claude", kimi: "Kimi", opencode: "OpenCode" };
export const backendLabel = (backend: AgentBackendId) => labels[backend];
const inlineLogo = (markup: string) =>
  markup
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/ (?:width|height)="1em"/g, "");

const logos: Record<AgentBackendId, string> = {
  codex: inlineLogo(AGENT_LOGO_MARKUP.codex),
  claude: inlineLogo(AGENT_LOGO_MARKUP.claude),
  kimi: inlineLogo(AGENT_LOGO_MARKUP.kimi),
  opencode: inlineLogo(AGENT_LOGO_MARKUP.opencode),
};

export type AgentIconTone = "brand" | "mono";

export function AgentBackendIcon({
  backend,
  tone = "brand",
  className,
  ...props
}: {
  backend: AgentBackendId;
  tone?: AgentIconTone;
} & ComponentProps<"span">) {
  const labelled = Boolean(props["aria-label"]);
  return createElement("span", {
    ...props,
    "aria-hidden": labelled ? undefined : true,
    role: props.role ?? (labelled ? "img" : undefined),

    className: `inline-block shrink-0 [&>svg]:block [&>svg]:size-full ${
      tone === "mono" ? "[&_*]:fill-current " : ""
    }${className ?? ""}`,
    dangerouslySetInnerHTML: { __html: logos[backend] },
  });
}
