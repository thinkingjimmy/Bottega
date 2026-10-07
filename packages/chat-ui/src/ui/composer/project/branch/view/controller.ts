/**
 * [INPUT]: Host branch port, Project identity, copy and creation locks.
 * [OUTPUT]: Fenced branch reads, paging, mutations and original-result recovery state.
 * [POS]: Shared branch selector state; every asynchronous result belongs to one mounted Project/port.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GitBranchRef, ProjectGitPage, ProjectGitPort } from "@ai-chat/cloud-protocol/resources/project-git";
import { branchError, type BranchCopy } from "../copy";

export type BranchSelectorProps = {
  projectId: string; port: ProjectGitPort; copy: BranchCopy; disabled?: boolean; unavailable?: string;
  onBusyChange(busy: boolean): void;
};
export function useBranchSelector({ projectId, port, copy, disabled, unavailable, onBusyChange }: BranchSelectorProps) {
  const [page, setPage] = useState<ProjectGitPage | null | undefined>(undefined);
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""), [createError, setCreateError] = useState("");
  const [createOpen, setCreateOpen] = useState(false), [name, setName] = useState("");
  const fence = useRef({ generation: 0, reads: 0 }), flight = useRef(false), unresolved = useRef(false), notify = useRef(onBusyChange);
  useLayoutEffect(() => { notify.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => {
    const current = fence.current;
    current.generation++; flight.current = false; unresolved.current = false;
    return () => { current.generation++; current.reads++; notify.current(false); };
  }, [projectId, port]);
  const load = useCallback(async (search: string, cursor: ProjectGitPage["nextCursor"] = null) => {
    if (unavailable) { setLoading(false); return; }
    if (flight.current) return;
    const current = fence.current.generation, read = ++fence.current.reads;
    const valid = () => current === fence.current.generation && read === fence.current.reads;
    setLoading(true);
    if (port.pending?.()) { unresolved.current = true; setUncertain(true); notify.current(true); }
    try {
      const next = await port.listBranches(projectId, { query: search, cursor });
      if (!valid()) return;
      setPage(previous => cursor && previous && next ? { ...next, branches: [...previous.branches, ...next.branches] } : next);
      setError(""); setCreateError(""); unresolved.current = false; setUncertain(false); notify.current(false);
    } catch (cause) {
      if (!valid()) return;
      const pending = port.pending?.() || unresolved.current;
      setUncertain(pending); notify.current(pending);
      setError(branchError(cause, copy, copy.loadFailed));
    } finally { if (valid()) setLoading(false); }
  }, [port, projectId, copy, unavailable]);
  useEffect(() => {
    const current = fence.current;
    const timer = setTimeout(() => void load(query), query ? 250 : 0);
    return () => { clearTimeout(timer); current.reads++; };
  }, [load, query]);
  const mutate = async (branch?: GitBranchRef) => {
    if (!page || disabled || unavailable || uncertain || flight.current || branch?.current || !branch && !name.trim()) return;
    const current = fence.current.generation;
    flight.current = true; fence.current.reads++; setLoading(false); setBusy(true); notify.current(true); setError(""); setCreateError("");
    let pending = false, changed = false;
    try {
      const next = branch ? await port.checkoutBranch(projectId, branch, page.workspaceToken) : await port.createBranch(projectId, name.trim(), page.workspaceToken);
      if (current !== fence.current.generation) return;
      setPage(next); setOpen(false); setCreateOpen(false); setName(""); setQuery("");
      changed = true;
    } catch (cause) {
      if (current !== fence.current.generation) return;
      pending = port.pending?.() || cause instanceof Error && cause.message === "remote-unknown";
      const message = branchError(cause, copy, branch ? copy.checkoutFailed : copy.createFailed);
      setError(message); if (!branch) setCreateError(message); unresolved.current = pending; setUncertain(pending);
    } finally {
      if (current === fence.current.generation) {
        flight.current = false; setBusy(false); notify.current(pending);
        if (changed && !query) void load("");
      }
    }
  };
  const search = (value: string) => { setQuery(value); setLoading(!unavailable); };
  return { page, open: open && !disabled, setOpen, query, setQuery: search, loading, busy, uncertain, error: unavailable ?? error,
    createError: unavailable ?? createError, createOpen: createOpen && !disabled, setCreateOpen, name, setName,
    locked: Boolean(disabled || unavailable || busy || uncertain), load, mutate };
}
