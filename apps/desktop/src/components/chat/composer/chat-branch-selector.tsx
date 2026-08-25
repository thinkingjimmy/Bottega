/**
 * [INPUT]: Depends on React, shared Git branch agreement, UI Popover/Command/Dialog/Input/Button and lucide icons
 * [OUTPUT]: Provides ChatBranchSelector, complete branch refresh/search/checkout/create with full visible status
 * [POS]: The Git interface boundaries of the chat/composer are in the context of the link; Only the consumer Provider is injected, not directly touching the IPC
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, GitBranch, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ai-chat/ui/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import type {
  GitBranchRef,
  GitBranchSnapshot,
  GitBranchTarget,
} from "../../../../shared/projects-ipc";
import { errorMessage } from "@/lib/errors";
import { composerContextButtonClass } from "./chat-project-selector";

type ChatBranchSelectorProps = {
  projectId: string;
  disabled: boolean;
  listBranches: (projectId: string) => Promise<GitBranchSnapshot | null>;
  checkoutBranch: (
    projectId: string,
    target: GitBranchTarget
  ) => Promise<GitBranchSnapshot>;
  createBranch: (
    projectId: string,
    name: string
  ) => Promise<GitBranchSnapshot>;
  onBusyChange: (busy: boolean) => void;
};

function BranchRow({
  branch,
  snapshot,
  busy,
  onSelect,
}: {
  branch: GitBranchRef;
  snapshot: GitBranchSnapshot;
  busy: boolean;
  onSelect: (branch: GitBranchRef) => void;
}) {
  return (
    <CommandItem
      className={`min-h-11 cursor-pointer px-3 py-2 text-sm ${branch.current ? "data-selected:bg-transparent" : ""}`}
      disabled={busy}
      value={branch.name}
      onSelect={() => onSelect(branch)}
    >
      <GitBranch className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{branch.name}</span>
        {branch.current && snapshot.uncommittedFiles > 0 && (
          <span className="block text-muted-foreground text-xs">
            Uncommitted: {snapshot.uncommittedFiles} files
          </span>
        )}
      </span>
      {branch.current && <Check className="ml-auto size-4" />}
    </CommandItem>
  );
}

export function ChatBranchSelector({
  projectId,
  disabled,
  listBranches,
  checkoutBranch,
  createBranch,
  onBusyChange,
}: ChatBranchSelectorProps) {
  const requestEpoch = useRef(0);
  const [snapshot, setSnapshot] = useState<GitBranchSnapshot | null>(null);
  const [repository, setRepository] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [createError, setCreateError] = useState("");

  const refresh = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    try {
      const next = await listBranches(projectId);
      if (requestEpoch.current !== epoch) return;
      setSnapshot(next);
      setRepository(Boolean(next));
      setError("");
    } catch (cause) {
      if (requestEpoch.current !== epoch) return;
      setRepository(true);
      setError(errorMessage(cause, "Branches 加载失败"));
    } finally {
      if (requestEpoch.current === epoch) setLoading(false);
    }
  }, [listBranches, projectId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    return () => {
      requestEpoch.current += 1;
    };
  }, [refresh]);

  const updateAfterFailure = async (message: string) => {
    try {
      const next = await listBranches(projectId);
      setSnapshot(next);
      setRepository(Boolean(next));
    } catch {
      // 保留原始 mutation 错误；下一次打开会再次刷新。
    }
    setError(message);
  };

  const selectBranch = async (branch: GitBranchRef) => {
    if (branch.current || busy) return;
    setBusy(true);
    setError("");
    onBusyChange(true);
    try {
      setSnapshot(await checkoutBranch(projectId, branch));
      setOpen(false);
    } catch (cause) {
      await updateAfterFailure(errorMessage(cause, "Branch 切换失败"));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  const submitCreate = async () => {
    const name = branchName.trim();
    if (!name || busy) return;
    setBusy(true);
    setCreateError("");
    onBusyChange(true);
    try {
      setSnapshot(await createBranch(projectId, name));
      setRepository(true);
      setCreateOpen(false);
      setBranchName("");
    } catch (cause) {
      setCreateError(errorMessage(cause, "Branch 创建失败"));
      try {
        const next = await listBranches(projectId);
        setSnapshot(next);
      } catch {
        // 创建错误是本次操作的主信息，不用刷新错误覆盖它。
      }
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  if (repository === false || (repository === null && !snapshot)) return null;

  const local = snapshot?.branches.filter((branch) => branch.kind === "local") ?? [];
  const remote = snapshot?.branches.filter((branch) => branch.kind === "remote") ?? [];
  const localNames = new Set(local.map((branch) => branch.name));
  const branches = [
    ...local,
    ...remote.filter((branch) => {
      const remoteBranchName = branch.name.split("/").slice(1).join("/");
      return !localNames.has(remoteBranchName);
    }),
  ];
  const triggerLabel = snapshot?.head ?? "Branches";

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled || busy) return;
          setOpen(next);
          if (next) void refresh();
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className={`${composerContextButtonClass} max-w-56 gap-2 aria-expanded:bg-muted-foreground/10`}
            disabled={disabled || busy}
          >
            {loading && !snapshot ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <GitBranch className="size-4" />
            )}
            <span className="truncate">{triggerLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          className="w-[18.5rem] overflow-hidden rounded-2xl p-0"
        >
          <Command className="min-h-72 rounded-2xl p-0 [&_[data-slot=command-input-wrapper]]:p-3 [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none">
            <CommandInput className="text-sm" placeholder="Search branches" />
            <CommandList className="max-h-72 min-h-48 px-2">
              <CommandEmpty>No branches found.</CommandEmpty>
              {snapshot?.detached && (
                <div className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm">
                  <GitBranch className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{snapshot.head}</span>
                    <span className="block text-muted-foreground text-xs">
                      Detached HEAD
                      {snapshot.uncommittedFiles > 0 &&
                        ` · Uncommitted: ${snapshot.uncommittedFiles} files`}
                    </span>
                  </span>
                  <Check className="size-4" />
                </div>
              )}
              {branches.length > 0 && (
                <CommandGroup heading="Branches">
                  {branches.map((branch) => (
                    <BranchRow
                      key={`${branch.kind}:${branch.name}`}
                      branch={branch}
                      snapshot={snapshot!}
                      busy={busy}
                      onSelect={(next) => void selectBranch(next)}
                    />
                  ))}
                </CommandGroup>
              )}
              {loading && snapshot && (
                <p className="px-3 py-2 text-muted-foreground text-xs">
                  Refreshing branches…
                </p>
              )}
              {error && (
                <p className="px-3 py-2 text-destructive text-xs" role="alert">
                  {error}
                </p>
              )}
            </CommandList>
            <div className="relative p-1 before:absolute before:top-0 before:right-3 before:left-3 before:border-border before:border-t">
              <Button
                type="button"
                variant="ghost"
                className="h-7 w-full justify-start gap-2 rounded-xl px-2 text-sm font-normal"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setCreateError("");
                  setCreateOpen(true);
                }}
              >
                <Plus className="size-4" />
                Create and checkout new branch…
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (busy) return;
          setCreateOpen(next);
          if (!next) {
            setBranchName("");
            setCreateError("");
          }
        }}
      >
        <DialogContent
          className="gap-5 rounded-3xl p-5 sm:max-w-[25rem]"
          overlayClassName="bg-black/20"
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              Create and checkout branch
            </DialogTitle>
            <DialogDescription className="sr-only">
              Create a local branch from the current HEAD and check it out.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-3 text-sm font-medium">
            <span>Branch name</span>
            <Input
              autoFocus
              className="h-10 rounded-xl text-sm font-normal"
              placeholder="new-branch"
              value={branchName}
              aria-invalid={Boolean(createError)}
              onChange={(event) => {
                setBranchName(event.target.value);
                setCreateError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitCreate();
              }}
            />
          </label>
          {createError && (
            <p className="text-destructive text-xs" role="alert">
              {createError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="rounded-xl px-4 text-sm"
              disabled={busy}
              onClick={() => setCreateOpen(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              size="lg"
              className="rounded-xl px-4 text-sm"
              disabled={!branchName.trim() || busy}
              onClick={() => void submitCreate()}
            >
              {busy ? "Creating…" : "Create and checkout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
