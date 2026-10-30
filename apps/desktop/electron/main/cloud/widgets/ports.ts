/**
 * [INPUT]: Depends only on immutable Widget package, encrypted delivery, progress and review types.
 * [OUTPUT]: Provides the deferred WidgetCloudPort and its exact frozen packet/request shapes.
 * [POS]: Type-only Dock/Cloud seam; it imports no crypto, compiler or transport implementation at startup.
 */
import type { WidgetPackageDescriptor } from "@bottega/contracts/plugins/dock/packages";
import type {
  WidgetPackageDelivery,
  WidgetPackageSubject,
} from "@ai-chat/cloud-protocol/widgets/model";
import type { FileProgress } from "@ai-chat/cloud-protocol";
import type { WidgetCloudClient } from "./client";
export type FrozenWidgetPacket = {
  reference: string;
  descriptor: WidgetPackageDescriptor;
  bytes: Buffer;
  sourceChat?:{chatId:string};
};
export type WidgetPackageRequest = {
  subject: WidgetPackageSubject;
  reference: string;
};
export type WidgetCloudReview = Awaited<
  ReturnType<WidgetCloudClient["review"]>
>;
export type WidgetCloudPort = {
  available(): boolean;
  catalog(cursor:string|null,signal?:AbortSignal):Promise<import("@ai-chat/cloud-protocol/widgets/catalog").WidgetCatalogPage>;
  watchCatalog(changed:(revision:number)=>void,failed:(error:unknown)=>void):()=>void;
  publish(
    packet: FrozenWidgetPacket,
    signal?: AbortSignal,
  ): Promise<WidgetPackageDelivery>;
  review(
    request: WidgetPackageRequest,
    signal?: AbortSignal,
  ): Promise<WidgetCloudReview>;
  download(
    delivery: WidgetPackageDelivery,
    signal?: AbortSignal,
    progress?: (value: FileProgress) => void,
  ): Promise<Buffer>;
  retire(
    subject: WidgetPackageSubject,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
};
