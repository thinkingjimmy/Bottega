/**
 * [INPUT]: Artifact title/status, host locale and the existing full-view/guarded-close presentation context.
 * [OUTPUT]: ArtifactHeader, ArtifactLoading and localized fullLabel with one title row and accessible view/close controls.
 * [POS]: Lightweight shared chrome for lazy and loaded design workspaces in native and Web hosts.
 */
import type { ReactNode } from "react";
import { Expand, Minimize2, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { toastClearanceRef } from "@ai-chat/ui/components/ui/sonner";
import { useArtifactHost, useArtifactPresentation } from "../context";

export function ArtifactHeader({ title, status, children }: { title: string; status?: string; children?: ReactNode }) {
  const host = useArtifactHost(), presentation = useArtifactPresentation(), locale = host?.locale ?? "en";
  const full = fullLabel(locale, presentation?.full), close = closeLabel(locale);
  return <header ref={toastClearanceRef} data-artifact-header="" data-toast-clearance="" className={`flex min-h-[60px] shrink-0 items-center gap-1 border-b bg-background px-3 ${host?.desktop ? "[-webkit-app-region:drag]" : ""}`}>
    <div className="min-w-0 flex-1 py-2"><h2 className="truncate text-sm font-medium" title={title}>{title}</h2>{status && <p role="status" className="truncate text-xs text-muted-foreground" title={status}>{status}</p>}</div>
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
