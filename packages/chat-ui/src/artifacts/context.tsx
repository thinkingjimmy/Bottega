/**
 * [INPUT]: Authenticated artifact fences and host-provided lifecycle, file and composer capabilities.
 * [OUTPUT]: ArtifactHostProvider and a portable viewer contract carrying draft callbacks and surface capabilities through open actions.
 * [POS]: Shared artifact UI dependency boundary for desktop and cloud reading.
 */
import { createContext, useContext } from "react";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
export type ArtifactLease = { id: string; url: string; origin: string; expiresAt: number; sandbox: "allow-scripts" | "allow-scripts allow-same-origin"; mount?: (frame: Window) => void };
export type ArtifactWorkbook = { exists: boolean; sheets: { name: string; imported: boolean; hasId: boolean }[] };
export type ArtifactHost = {
  scope: string; locale: string; desktop?: boolean; directoryTopLevel?: boolean; sidePanel?: boolean;
  acquire(fence: ArtifactFence): Promise<ArtifactLease>; release(lease: ArtifactLease): void;
  action(fence: ArtifactFence, action: "quick-look" | "reveal" | "open" | "save", followUp?: ArtifactHost["followUp"]): Promise<void>;
  open(fence: ArtifactFence, followUp?: ArtifactHost["followUp"]): void | Promise<void>;
  followUp?(value: { prompt: string; title?: string }): void;
  workbook?(fence: ArtifactFence): Promise<ArtifactWorkbook>;
  importBase?(fence: ArtifactFence, sheet: string, confirmed: boolean): Promise<unknown>;
};
const Context = createContext<ArtifactHost | null>(null);
export const ArtifactHostProvider = Context.Provider;
export const useArtifactHost = () => useContext(Context);
