/**
 * [INPUT]: Public plugin SDK capability shape supplied by the fixed compiler.
 * [OUTPUT]: Local declarations for the audited official Sketch module build.
 * [POS]: Compile-time only; the runtime is the compiler's virtual @bottega/plugin-react module.
 */
declare module '@bottega/plugin-react' {
  type Format = { id: string; version: number; readableVersions?: readonly number[] };
  export function usePlugin(): {
    session: { sessionId: string; pluginId: string; generationId: string; locale: string; sourceFormat: Format;
      sourceId?: string; recoverySourceId?: string; recoveryIncompatible?:boolean; attachmentId?: string } | null;
    setDirty(value: boolean): Promise<void>; readSource(id: string): Promise<Uint8Array>;
    submitAttachment(value: { image: File; source: Uint8Array; format: Format; replaceAttachmentId?: string }): Promise<{attachmentId:string}>;
    checkpoint(source: Uint8Array, format: Format): Promise<{sourceId:string}>;
    computeCoverage(bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>; cancelCoverage(): Promise<void>;
    close(value?: {saved?:boolean;discarded?:boolean}): Promise<void>;
  };
}
