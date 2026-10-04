/**
 * [INPUT]: React nodes, Base rows and record contribution contracts.
 * [OUTPUT]: BaseWorkbenchCommonProps, BaseWorkbenchProps.
 * [POS]: Base workbench public composition and capability contract.
 */
import type { ReactNode } from "react";
import type { BaseRow } from "@ai-chat/base-core/model/bases-ipc";
import { type RecordContribution } from "../state/record-slots";

export type BaseWorkbenchCommonProps = {
  ownerKey: string;
  compact?: boolean;
  attachmentOwner?: { chatId: string; incarnationId: string };
  requestedViewId?: { viewId: string; nonce: number | string };
  requestedRecordId?: { recordId: string; nonce: number | string };
  onRecordChange?(recordId: string | null): void;
  recordContributions?: readonly RecordContribution[];
  toolbar?: ReactNode;
  /** The host's workflow entry for a task; the table shows ▶ only in builds with the workbench flag. */
  onRunWorkflow?(row: BaseRow): void;
};

export type BaseWorkbenchProps = BaseWorkbenchCommonProps &
  (
    | { capability?: "full"; surfaceLeaseId?: never; renewSurfaceLease?: never }
    | { capability: "read"; surfaceLeaseId?: never; renewSurfaceLease?: never }
    | { capability: "data-write"; surfaceLeaseId?: never; renewSurfaceLease?: never }
    /** renewSurfaceLease re-acquires a lease main stopped honouring; the host keeps it stable (useCallback). */
    | { capability: "row-write"; surfaceLeaseId: string; renewSurfaceLease?: () => Promise<string> }
  );
