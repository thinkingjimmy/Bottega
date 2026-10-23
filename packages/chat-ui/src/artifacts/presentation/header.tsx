/**
 * [INPUT]: Artifact title/status, an optional title-menu wrapper, actual native sidebar-trigger bounds, host locale and the existing full-view/guarded-close presentation context.
 * [OUTPUT]: ArtifactHeader, ArtifactLoading and localized fullLabel with a compact static or interactive title and accessible view/close controls.
 * [POS]: Lightweight shared chrome for lazy and loaded design workspaces in native and Web hosts.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Expand, Minimize2, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { toastClearanceRef } from "@ai-chat/ui/components/ui/sonner";
import { useArtifactHost, useArtifactPresentation } from "../context";

export function ArtifactHeader({ title, status, titleMenu, children }: { title: string; status?: string; titleMenu?(content: ReactNode): ReactNode; children?: ReactNode }) {
  const host = useArtifactHost(), presentation = useArtifactPresentation(), locale = host?.locale ?? "en";
  const header = useRef<HTMLElement>(null), [leftInset, setLeftInset] = useState(0);
  const headerRef = useCallback((node: HTMLElement | null) => { header.current = node; return toastClearanceRef(node); }, []);
  useLayoutEffect(() => {
    const node = header.current, trigger = document.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]');
    if (!host?.desktop || !node || !trigger) { setLeftInset(0); return; }
    const measure = () => {
      const bounds = node.getBoundingClientRect(), control = trigger.getBoundingClientRect();
      const overlaps = control.width > 0 && control.height > 0 && control.left < bounds.right && control.right > bounds.left && control.top < bounds.bottom && control.bottom > bounds.top;
      setLeftInset(overlaps ? Math.max(12, control.right - bounds.left + 12) : 0);
    };
    const observer = new ResizeObserver(measure); observer.observe(node); observer.observe(trigger);
    window.addEventListener("resize", measure); measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [host?.desktop, presentation?.full]);
  const full = fullLabel(locale, presentation?.full), close = closeLabel(locale);
  const titleText = titleMenu ? <span data-artifact-title="" className="block truncate text-sm font-medium" title={title}>{title}</span> : <h2 data-artifact-title="" className="truncate text-sm font-medium" title={title}>{title}</h2>;
  const statusText = status && <span role="status" className="block truncate text-xs text-muted-foreground" title={status}>{status}</span>;
  return <header ref={headerRef} data-artifact-header="" data-toast-clearance="" style={leftInset ? { paddingLeft: leftInset } : undefined} className={`flex min-h-[60px] shrink-0 items-center gap-1 border-b bg-background px-3 ${host?.desktop ? "[-webkit-app-region:drag]" : ""}`}>
    <div className="min-w-0 flex-1 py-1.5">{titleMenu ? titleMenu(<span className="block min-w-0">{titleText}{statusText}</span>) : <>{titleText}{statusText}</>}</div>
    <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
      {children}
      {presentation?.canExpand && <Button type="button" variant="ghost" size="icon" data-artifact-expand="" className="min-h-[44px] min-w-[44px]" aria-label={full} title={full} onClick={() => presentation.setFull(!presentation.full)}>{presentation.full ? <Minimize2 className="size-4" /> : <Expand className="size-4" />}</Button>}
      {presentation && <Button type="button" variant="ghost" size="icon" data-artifact-close="" className="min-h-[44px] min-w-[44px]" aria-label={close} title={close} onClick={presentation.close}><X className="size-4" /></Button>}
    </div>
  </header>;
}

export function ArtifactLoading({ title }: { title: string }) {
  return <div aria-busy="true" className="flex min-h-0 flex-1 flex-col"><ArtifactHeader title={title} /><div className="min-h-0 flex-1" /></div>;
}

export const fullLabel = (locale: string, back = false) => locale.startsWith("zh") ? back ? "返回会话" : "完整视图" : locale.startsWith("ja") ? back ? "チャットに戻る" : "全体表示" : locale.startsWith("fr") ? back ? "Retour au chat" : "Vue complète" : locale.startsWith("es") ? back ? "Volver al chat" : "Vista completa" : back ? "Back to Chat" : "Full view";

const closeLabel = (locale: string) => locale.startsWith("zh") ? "关闭" : locale.startsWith("ja") ? "閉じる" : locale.startsWith("fr") ? "Fermer" : locale.startsWith("es") ? "Cerrar" : "Close";
