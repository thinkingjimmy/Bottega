/**
 * [INPUT]: Prompt input types, workspace scope, remote file references, and empty queue/Sketch resource factories.
 * [OUTPUT]: ComposerFile, FileNode, FileResource, ComposerState, emptyComposer.
 * [POS]: apps/desktop/src/lib/chat/state/composer; Immutable composer shape and empty-state factory; mutable custody remains in the composer store.
 */
import type { PromptInputFilePart, RichNode, RichValue } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { AgentWorkspaceScope } from "../../../../../shared/ipc/agent/agent-ipc";
import { emptyMessageQueue, type MessageQueue } from "../../session/message-queue-model";
import { emptySketchResources, type ComposerSketchResources } from "../../../chat-composer/resources";
import type { RemoteFileReference } from "@ai-chat/cloud-protocol/remote/input/references";

export type ComposerFile = PromptInputFilePart & {
  pluginSource?: import("@bottega/contracts/plugins/surface/source").PluginSource;
  id: string;
  origin?: {
    kind: "gallery";
    logicalKey: string;
    sourceRevision: string;
    selectionToken: string;
    materializationToken: string;
  };
};

export type FileNode = Extract<RichNode, { type: "file" }>;

export type FileResource = { file?: File; node: FileNode; scope?: AgentWorkspaceScope };

export type ComposerState = {
  /** "" = 尚未认领任何一世。它不是「某一世」，因此不能拿去和真实世代比大小。 */
  incarnationId: string;
  /** 草稿的目标 Project；落盘后归属由 record 接管，这个值就此定格、不再变化。 */
  projectId: string | null;
  /** "" = workspace 身份尚未水合；已知值与草稿同寿，不随组件卸载丢失。 */
  workspaceIdentityKey: string;
  queue: MessageQueue;
  handledSteerIntents: ReadonlySet<string>;
  draft: { richValue: RichValue; files: ComposerFile[] };
  /** Draft images that could not follow a window move; each stays as a removable chip until the person removes it. */
  unavailableAttachments: readonly Readonly<{ id: string; name: string }>[];
  fileResources: Map<string, FileResource>;
  workspaceReferences: ReadonlyMap<string, RemoteFileReference>;
  sketch: ComposerSketchResources;
  sketchEditable: boolean;
};

export const emptyComposer = (incarnationId = ""): ComposerState => ({
  incarnationId,
  projectId: null,
  workspaceIdentityKey: "",
  queue: emptyMessageQueue(),
  handledSteerIntents: new Set(),
  draft: { richValue: [], files: [] },
  unavailableAttachments: [],
  fileResources: new Map(),
  workspaceReferences: new Map(),
  sketch: emptySketchResources(),
  sketchEditable: true,
});
