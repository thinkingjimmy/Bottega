/**
 * [INPUT]: Record contribution contracts and native isolated Surface descriptors.
 * [OUTPUT]: Main-window record Surface bridge and import-free channel names.
 * [POS]: Trusted product UI seam; this bridge is never exposed to a package frame.
 */
import type { RecordCall, RecordEntry, RecordOpen, RecordTarget } from "./contract";
import type { PluginSurfaceDescriptor } from "../surface/native";
export interface RecordPluginsBridge {
  list(): Promise<readonly RecordEntry[]>;
  open(input: RecordOpen): Promise<PluginSurfaceDescriptor>;
  call(leaseId: string, input: RecordCall): Promise<unknown>;
  results(target: RecordTarget, result?: { resultRef: string; offset: number }): Promise<unknown>;
}
export const RECORD_PLUGINS_CHANNEL = { list: "record-plugins:list", open: "record-plugins:open", call: "record-plugins:call", results: "record-plugins:results" } as const;
