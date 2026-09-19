/**
 * [INPUT]: An immutable file identity, host-owned text reader and localized feedback.
 * [OUTPUT]: Cancellable text preview with retry and stale-result rejection.
 * [POS]: Shared third-column workspace surface; filesystem and encryption stay in platform adapters.
 */
import { useEffect, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
export type WorkspacePreviewRequest = { key: string; title: string; unavailableMessage?: string; read(signal: AbortSignal): Promise<string> };
export function WorkspacePreview({ request, copy }: { request: WorkspacePreviewRequest; copy: { loading: string; failed: string; retry: string } }) {
  const [cycle, setCycle] = useState(0), [value, setValue] = useState<{ request: WorkspacePreviewRequest; cycle: number; content?: string; failed?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void request.read(controller.signal).then(content => {
      if (!controller.signal.aborted) setValue({ request, cycle, content });
    }, error => { if (!controller.signal.aborted) setValue({ request, cycle, failed: error instanceof Error && error.message === "target-offline" ? request.unavailableMessage ?? copy.failed : copy.failed }); });
    return () => controller.abort();
  }, [request, cycle, copy.failed]);
  if (value?.request !== request || value.cycle !== cycle) return <p role="status" className="p-4 text-sm text-muted-foreground">{copy.loading}</p>;
  if (value.failed) return <div role="alert" className="grid gap-3 p-4 text-sm"><p>{value.failed}</p><Button variant="outline" onClick={() => setCycle(value => value + 1)}>{copy.retry}</Button></div>;
  return <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-xs" tabIndex={0}>{value.content}</pre>;
}
