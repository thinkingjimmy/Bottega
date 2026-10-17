/**
 * [INPUT]: Authenticated artifact fences and host-provided lifecycle, file and composer capabilities.
 * [OUTPUT]: Owner-bound workspace/file/lease ports, separate presentation/close hooks and original-composer callbacks.
 * [POS]: Shared artifact UI dependency boundary for desktop and cloud reading.
 */
import { createContext, useContext } from "react";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
export type ArtifactLease = { id: string; url: string; origin: string; expiresAt: number; sandbox: "allow-scripts" | "allow-scripts allow-same-origin"; mount?: (frame: Window) => void };
export type ArtifactWorkbook = { exists: boolean; sheets: { name: string; imported: boolean; hasId: boolean }[] };
export type ArtifactHost = {
  scope: string; locale: string; desktop?: boolean; directoryTopLevel?: boolean; sidePanel?: boolean;
  executionDeviceId?: string;
  remoteReader?: boolean;
  remember?(fence: ArtifactFence): void;
  acquire(fence: ArtifactFence): Promise<ArtifactLease>; release(lease: ArtifactLease): void;
  action(fence: ArtifactFence, action: "quick-look" | "reveal" | "open" | "save", followUp?: ArtifactHost["followUp"]): Promise<void>;
  open(fence: ArtifactFence, followUp?: ArtifactHost["followUp"]): void | Promise<void>;
  followUp?(value: { prompt: string; title?: string; design?: import("@ai-chat/cloud-protocol/artifacts/design/review").DesignReference }): void | Promise<void>;
  sendReview?(value: { prompt: string; title?: string; design: import("@ai-chat/cloud-protocol/artifacts/design/review").DesignReference; requestId: string; createdAt: number }): Promise<void>;
  workspace?(input: Omit<import("@ai-chat/cloud-protocol/artifacts/design/model").WorkspaceCommand, "chatId" | "incarnationId">): Promise<unknown>;
  workspaceEvents?(listener: (event: { type: "before-disable" | "changed"; nonce?: string; generation: string; enabled?: boolean; scope?: string }) => void | Promise<void>): () => void;
  preview?(fence: ArtifactFence, action: "preview-status" | "preview-start" | "preview-stop" | "preview-issue-code"): Promise<import("@ai-chat/cloud-protocol/resources/preview").PreviewView>;
  keepPreview?(fence: ArtifactFence): Promise<import("@ai-chat/cloud-protocol/resources/preview").PreviewView>;
  openPreview?(url: string): Promise<void>;
  managePreviews?(): void;
  workbook?(fence: ArtifactFence): Promise<ArtifactWorkbook>;
  importBase?(fence: ArtifactFence, sheet: string, confirmed: boolean): Promise<unknown>;
};
const Context = createContext<ArtifactHost | null>(null);
export const ArtifactHostProvider = Context.Provider;
export const useArtifactHost = () => useContext(Context);
export type ArtifactPresentation = { full: boolean; canExpand: boolean; setFull(full: boolean): void; close(): void;
  beforeClose?(handler: () => Promise<unknown>): () => void };
const Presentation = createContext<ArtifactPresentation | null>(null);
export const ArtifactPresentationProvider = Presentation.Provider;
export const useArtifactPresentation = () => useContext(Presentation);
export { artifactCopy } from "./copy";
