/**
 * [INPUT]: Canonical rich input, current Chat/incarnation and main-owned workspace references.
 * [OUTPUT]: Design-reference validation before admission and again before actual dispatch.
 * [POS]: Explicit design request gate; ordinary text is never classified by keywords.
 */
import type { CanonicalRichInputNode } from "../../../../shared/content/rich/rich-input-projection";
export async function assertDesignReferences(chatId: string, incarnationId: string | undefined, nodes: readonly CanonicalRichInputNode[]) {
  const references = nodes.filter(node => node.type === "design"); if (!references.length) return;
  if (!incarnationId) throw new Error("Design references require the original Chat incarnation");
  const { artifactWorkspace } = await import("./runtime");
  for (const reference of references) await artifactWorkspace().authorizeReference(chatId, incarnationId, reference.reference);
}
