/**
 * [INPUT]: Portable Chat identity and React component contracts.
 * [OUTPUT]: Base authority, history, navigation and editor ports for one panel host.
 * [POS]: SDK/IPC-free boundary; adapters retain durable mutations and unsaved editors.
 */
import type { ComponentType } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
export type PanelBaseTarget = { baseId: string; project: boolean };
export type PanelBaseState = { target: PanelBaseTarget | null; resolved: boolean; error: boolean; promoted: string | null; retry(): void };
export type PanelBaseProps = { chatId: string; incarnationId: string; targetBaseId: string | null; project: boolean; visible: boolean; locale: string; onDirtyChange(dirty: boolean): void };
export type PanelServices = {
  memory?: import("./memory").PanelMemory;
  widths?: import("../layout").PanelWidths;
  capabilities: Pick<import("../../../platform/contracts").ChatCapabilities, "browser" | "apps">;
  /** A browser host declares false: only a native host can install the App it names. Omitted means it can. */
  canInstallApps?: boolean;
  useBase(head: CloudChatHead | null, cycle: number): PanelBaseState;
  createBase(head: CloudChatHead): Promise<unknown>;
  BaseTab: ComponentType<PanelBaseProps>;
  useHistory(allowed: boolean, narrow: boolean, initialOpen: boolean, onIntent: (open: boolean) => void): { open: boolean; takeover: boolean; openShell(): void; close(): void };
  deviceName: string | null | undefined;
  navigate(path: string): void;
};
