/**
 * [INPUT]: Depends on immutable field descriptors, verified private-file reads and UTF-8 text windows.
 * [OUTPUT]: Provides scoped single-flight reads, explicit verified full-text reads, immediate prepared-body reuse, page navigation and per-mount object-URL cleanup.
 * [POS]: The imported subtree's content lifetime owner; only small visible message bodies opt into automatic loading.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { TranscriptSource } from "../../../../platform/contracts";
import { importedTextWindow, readImportedField, type PreparedImportedField } from "../../../../platform/transcript/fields";
export { AUTOMATIC_FIELD_BYTES } from "../../../../platform/transcript/fields";
type Field = ImportedEntry["fields"][number];
type Value = {
  busy?: boolean;
  error?: boolean;
  blob?: Blob;
  url?: string;
  text?: string;
  next?: number | null;
  previous: number[];
};
const empty: Value = { previous: [] };

export function useImportedField(
  chatId: string,
  field: Field,
  source: Pick<TranscriptSource, "file">,
  automatic = false,
  prepared?: PreparedImportedField,
) {
  const scope = useMemo(
    () => ({ chatId, field, source, prepared }),
    [chatId, field, source, prepared],
  );
  const [state, setState] = useState<{
    scope: typeof scope;
    value: Value;
  } | null>(null);
  type Request = {
    scope: typeof scope;
    controller: AbortController;
    url?: string;
    blob?: Blob;
    pending?: Promise<Blob | undefined>;
    loaded: boolean;
  };
  const request = useRef<Request | null>(null);
  const value: Value = state?.scope === scope ? state.value : prepared ? { ...prepared, previous: prepared.error ? [] : [0] } : empty;
  const load = useCallback((): Promise<Blob | undefined> => {
    if (
      request.current?.scope === scope &&
      !request.current.controller.signal.aborted
    )
      return request.current.pending ?? Promise.resolve(request.current.blob);
    const current: Request = {
      scope,
      controller: new AbortController(),
      loaded: false,
      url: undefined as string | undefined,
    };
    request.current = current;
    if (!scope.prepared || scope.prepared.error) setState({ scope, value: { busy: true, previous: [] } });
    current.pending = (async () => {
      try {
        const blob = scope.prepared && !scope.prepared.error ? scope.prepared.blob : await readImportedField(
          scope.chatId,
          scope.field,
          scope.source,
          current.controller.signal,
        );
        const page = scope.prepared && !scope.prepared.error ? scope.prepared : await importedTextWindow(blob, 0, current.controller.signal);
        if (current.controller.signal.aborted || request.current !== current)
          return;
        current.url = URL.createObjectURL(blob);
        current.blob = blob;
        current.loaded = true;
        setState({
          scope,
          value: { blob, url: current.url, ...page, previous: [0] },
        });
        return blob;
      } catch {
        if (!current.controller.signal.aborted && request.current === current) {
          request.current = null;
          setState({ scope, value: { error: true, previous: [] } });
        }
      }
    })();
    return current.pending;
  }, [scope]);
  async function readText() {
    const blob = await load(), current = request.current;
    if (!blob || current?.scope !== scope) throw new Error("IMPORTED_FIELD_UNAVAILABLE");
    const text = await blob.text();
    current.controller.signal.throwIfAborted();
    if (request.current !== current) throw new Error("IMPORTED_FIELD_SCOPE_CHANGED");
    return text;
  }
  useEffect(() => {
    let active = true;
    // Coalesce replayed mounts before starting a private-file lease.
    if (automatic && !prepared?.error) queueMicrotask(() => { if (active) void load(); });
    return () => {
      active = false;
      const current = request.current;
      if (current?.scope !== scope) return;
      current.controller.abort();
      if (current.url) URL.revokeObjectURL(current.url);
      request.current = null;
    };
  }, [automatic, load, scope, prepared]);
  async function move(offset: number, previous: number[]) {
    const current = request.current;
    if (!value.blob || current?.scope !== scope || !current.loaded) return;
    try {
      const page = await importedTextWindow(
        value.blob,
        offset,
        current.controller.signal,
      );
      if (!current.controller.signal.aborted && request.current === current)
        setState({
          scope,
          value: { ...value, ...page, previous, error: false },
        });
    } catch {
      if (!current.controller.signal.aborted && request.current === current)
        setState({ scope, value: { ...value, error: true } });
    }
  }
  return { value, load, move, readText };
}
