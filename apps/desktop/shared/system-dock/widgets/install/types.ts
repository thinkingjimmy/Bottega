/**
 * [INPUT]: Depends only on public Widget declaration and full source identity types.
 * [OUTPUT]: Provides pathless WidgetInstallReview, WidgetInstallResult, WidgetInstallProgress, WidgetInstalledDefinition, WidgetAccountDefinition and WidgetDeliveryView for trusted host UI.
 * [POS]: Product installation projection; metadata, installation confirmation, local selection and data grants remain distinct.
 */
import type { DockContribution } from "@bottega/contracts/plugins/dock/manifest";
export type WidgetInstallReview = {
  reviewId: string;
  name: string;
  reference: string;
  generationId: string;
  sourceInstallationId: string;
  definitionId: string;
  dock: DockContribution;
  cached: boolean;
  repair?:boolean;
  instances: readonly { id: string; name: string; updating: boolean }[];
};
export type WidgetInstallResult = {
  operationId: string;
  reference: string;
  state: "pending" | "installed" | "failed" | "conflict" | "cancelled";
  itemIds: string[];
  needsSetup: string[];
};
export type WidgetInstallProgress = {
  operationId: string;
  reference: string;
  phase: "downloading" | "verifying" | "registering";
  completedBytes: number | null;
  totalBytes: number | null;
};
export type WidgetDeliveryView = {
  definitionId: string;
  reference: string;
  generationId: string;
  state:
    "preparing" | "transferring" | "pending" | "ready" | "failed" | "abandoned";
};

export type WidgetInstalledDefinition={key:string;definitionId:string;sourceInstallationId:string;name:string;reference:string;instanceCount:number;sourceChatId?:string};

export type WidgetAccountDefinition={key:string;definitionId:string;sourceInstallationId:string;reference:string;name:string;description:string;sourceChatId?:string};
