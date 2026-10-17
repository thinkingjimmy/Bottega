/**
 * [INPUT]: Fixed owner read state, exact trusted anchor and the CM canvas-target capability port.
 * [OUTPUT]: Revision/scope-bound verified target result and readable closed limitation copy with a dedicated flowLayout reason.
 * [POS]: Read-only source capability adapter; frame hints never authorize editing.
 */
import { useEffect, useState } from "react";
import { canvasTargetSchema, type CanvasTarget } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignAnchor } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { useArtifactHost } from "../../../../../context";
import { canvasCopy } from "../../copy";
export function useCanvasTarget(artifactId: string, state: WorkspaceRead | null, anchor: DesignAnchor | null) {
  const host = useArtifactHost()!, copy = canvasCopy(host.locale), key = JSON.stringify([host.scope, artifactId, state?.revision, state?.generation, anchor]), [result, setResult] = useState<{ key: string; target?: CanvasTarget; failed?: boolean }>({ key: "" });
  useEffect(() => {
    if (!anchor || !state?.canvas || !host.workspace) return;
    let alive = true;
    void host.workspace({ action: "canvas-target", artifactId, generation: state.generation, anchor }).then(value => {
      const target = canvasTargetSchema.parse(value); if (alive) setResult({ key, target });
    }).catch(() => { if (alive) setResult({ key, failed: true }); });
    return () => { alive = false; };
  }, [host, artifactId, state?.canvas, state?.generation, anchor, key]);
  const target = result.key === key ? result.target : undefined;
  return { target, failed: result.key === key && result.failed, loading: Boolean(anchor && state?.canvas && result.key !== key), reason: target?.reason ? /flow|position|transform/i.test(target.reason) ? copy.flowLayout : /nested|direct.text/i.test(target.reason) ? copy.nested : /script|runtime|component|dynamic/i.test(target.reason) ? copy.dynamic : /unique|ambiguous|selector|match/i.test(target.reason) ? copy.ambiguous : copy.unsupported : result.key === key && result.failed ? copy.failed : copy.unsupported };
}
