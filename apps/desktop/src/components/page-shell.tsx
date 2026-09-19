/**
 * [INPUT]: Router links, desktop i18n/platform and shared WorkspacePage/WorkspaceBackLink.
 * [OUTPUT]: PageShell, DesktopWorkspaceHeader and common panel geometry.
 * [POS]: Desktop page adapter; native chrome remains host-owned.
 */
import type { ComponentProps } from "react";
import { Link } from "react-router";
import { useSidebar } from "@ai-chat/ui/components/ui/sidebar";
import { WorkspaceBackLink, WorkspaceHeader, WorkspacePage } from "@ai-chat/ui/components/workspace/page";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { isApplePlatform } from "@/lib/platform";
export { panelChromeClassName, crossHeaderPanelStyle } from "@ai-chat/ui/components/workspace/page";
type PageShellProps = Omit<ComponentProps<typeof WorkspacePage>, "leading" | "chrome" | "collapsedInset"> & { backHref?: string };
export function PageShell({ backHref, ...props }: PageShellProps) {
  const { t } = useAppTranslation(), { state } = useSidebar();
  return <WorkspacePage {...props} chrome="native" collapsedInset={state === "collapsed" ? isApplePlatform() ? "mac" : "compact" : undefined}
    leading={backHref && <WorkspaceBackLink aria-label={t("common.back")} asChild><Link to={backHref} /></WorkspaceBackLink>} />;
}

export function DesktopWorkspaceHeader(props: Omit<ComponentProps<typeof WorkspaceHeader>, "chrome" | "collapsedInset">) {
  const { state } = useSidebar();
  return <WorkspaceHeader {...props} chrome="native" collapsedInset={state === "collapsed" ? isApplePlatform() ? "mac" : "compact" : undefined} />;
}
