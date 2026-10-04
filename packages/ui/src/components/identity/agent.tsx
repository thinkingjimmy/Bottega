/**
 * [INPUT]: Bundled, trusted Agent logo markup, lucide-react and React.
 * [OUTPUT]: Shared backendLabel, AgentBackendIcon, AgentBackendId (an open Provider id) and AgentIconTone.
 * [POS]: Shared Agent identity independent of native availability policy; bundled marks cover the built-in providers and any other id renders a neutral mark and its own id, never a crash.
 */
import { createElement, type ComponentProps } from "react";
import { Bot } from "lucide-react";
import { AGENT_LOGO_MARKUP } from "../../../../model-logos/inline";
/** A Provider id in the contract's bounded form (`providerIdSchema` in @ai-chat/cloud-protocol/contracts/provider), not a closed union. */
export type AgentBackendId = string;
type BundledId = keyof typeof AGENT_LOGO_MARKUP;
const labels: Record<BundledId, string> = { codex: "Codex", claude: "Claude", kimi: "Kimi", opencode: "OpenCode" };
const bundled = (backend: string): backend is BundledId => Object.hasOwn(labels, backend);
export const backendLabel = (backend: AgentBackendId) => bundled(backend) ? labels[backend] : backend;
const inlineLogo = (markup: string) =>
  markup
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/ (?:width|height)="1em"/g, "");

const logos: Record<BundledId, string> = {
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
  const known = bundled(backend);
  return createElement("span", {
    ...props,
    "aria-hidden": labelled ? undefined : true,
    role: props.role ?? (labelled ? "img" : undefined),

    className: `inline-block shrink-0 [&>svg]:block [&>svg]:size-full ${
      tone === "mono" && known ? "[&_*]:fill-current " : ""
    }${className ?? ""}`,
    ...(known ? { dangerouslySetInnerHTML: { __html: logos[backend] } } : { "data-provider-fallback": "", children: createElement(Bot, { "aria-hidden": true }) }),
  });
}
