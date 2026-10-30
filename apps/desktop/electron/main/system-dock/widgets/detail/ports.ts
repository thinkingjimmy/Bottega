/**
* [INPUT]: Depends on accepted Widget mappings, verified declarations, Dock readings and Electron panel identity types.
* [OUTPUT]: Provides the main-only native detail source, lifecycle and integration ports.
* [POS]: Composition seam; no native object, path, nonce or capability enters the Dock renderer.
*/
import type { BrowserWindow } from 'electron';
import type { DockReading } from '@bottega/contracts/plugins/dock/data';
import type { DockAction } from '@bottega/contracts/plugins/dock/session';
import type { DockPluginManifest } from '../../../apps/gui-build/source/manifest';
import type { WidgetPackageStore } from '../../../plugins/surface-runtime/packages/store';
import type { PluginSurfaceGateway } from '../../../plugins/surface-runtime/gateway';
import type { AcceptedWidget } from '../../store/custom/model';
import type { WidgetItem } from '../custom/ports';
import type { DockDetailSlot, DockDetailPresentation, WidgetRuntimeHealth } from '../../../../../shared/system-dock/widgets/native';
export type WidgetDetailSource = Readonly<{
  item: WidgetItem;
  accepted: AcceptedWidget;
  manifest: DockPluginManifest;
  dataIdentity: string;
}>;
export type WidgetDetailPorts = {
  contextKind?: 'dock-detail' | 'authoring-preview';
  mainDirectory: string;
  gateway: PluginSurfaceGateway;
  packages: Pick<WidgetPackageStore,'read'>;
  source(itemId: string): WidgetDetailSource | null;
  read(itemId: string, sources?: readonly string[]): Readonly<Record<string, DockReading>>;
  actions(owner:string,itemId:string):readonly DockAction[];
  invokeAction(owner:string,itemId:string,ref:string,current:()=>boolean):Promise<void>;
  releaseActions(owner:string):void;
  locale(): string;
  theme(): 'light' | 'dark';
  changed(): void;
  closePanel(): void;
  focusPanel(): void;
  label(key: string): string;
};
export interface DockWidgetDetailPort {
  presented(window: BrowserWindow | null, itemId: string | null): void;
  bounds(slot: DockDetailSlot): void;
  retry(itemId: string, key: string): void;
  reconcile(): void;
  presentation(source: WidgetDetailSource): DockDetailPresentation;
  health(): WidgetRuntimeHealth;
  close(): Promise<void>;
}
