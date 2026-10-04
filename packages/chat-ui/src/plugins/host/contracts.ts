/**
 * [INPUT]: Opaque source identity and React host rendering contracts.
 * [OUTPUT]: Shared plugin catalog, frame, recovery and current-draft host ports.
 * [POS]: Portable renderer contract; native and Cloud adapters own transport and persistence.
 */
import type { ComponentType } from 'react';
import type { PluginSource } from '@bottega/contracts/plugins/surface/source';
export type PluginSourceFormat = { id: string; version: number; readableVersions: readonly number[] };
export type PluginComposerEntry = { id: string; name: string; enabled: boolean; error: string | null; generationId: string | null; records?: import('@bottega/contracts/plugins/records/contract').RecordUi;
  composer: { id: string; title: string; icon: string }; sourceFormat: PluginSourceFormat };
export type PluginHostScope = { chatId: string; incarnationId: string; ownerDeviceId: string };
export type PluginEndReason = 'saved' | 'discarded' | 'generation' | 'disabled' | 'revoked' | 'lease-expired' | 'crash';
export type PluginRecoveryPort = { read(): Promise<PluginSource | null>; write(source: PluginSource): Promise<void>; remove(): Promise<void> };
export type PluginSurfacePreferences = {locale:string;theme:'light'|'dark'};
export type PluginSurfaceProps = { preferences:PluginSurfacePreferences; entry: PluginComposerEntry; scope: PluginHostScope;
  createDispatch(identity: { generationId: string; sourceFormat: PluginSourceFormat }): (operation: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>;
  beforeEnd(reason: PluginEndReason): Promise<void>; onStatus(status: string): void };
export type PluginSurfaceEnvironment = { Surface: ComponentType<PluginSurfaceProps>;
  recovery(scope: PluginHostScope & { pluginId: string; attachmentId?:string }): PluginRecoveryPort };
