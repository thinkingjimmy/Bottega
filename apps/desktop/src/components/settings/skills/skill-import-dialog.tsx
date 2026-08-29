/**
 * [INPUT]: Depends on main-produced candidate previews/source facts, i18n, dialog primitives, and caller-owned selection/import callbacks
 * [OUTPUT]: Provides a two-stage source/candidate import dialog with no target or projection concepts
 * [POS]: Sole Skills acquisition dialog; importing always means copy into the product Library and enable
 */

import { ArrowLeft, FolderOpen } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AppDialogBody, AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type {
  ManagedSkillAgent,
  ManagedSkillImportPreview,
  ManagedSkillSourceView,
} from "../../../../shared/unified-skills-ipc";
import { actionableCandidate, skillReasonText } from "./skill-text";

export function SkillImportDialog({
  open,
  sources,
  preview,
  selected,
  busy,
  onOpenChange,
  onOpenSource,
  onBack,
  onSelected,
  onImport,
}: {
  open: boolean;
  sources: readonly ManagedSkillSourceView[];
  preview: ManagedSkillImportPreview | null;
  selected: ReadonlySet<string>;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onOpenSource(source: ManagedSkillAgent | "local-folder"): void;
  onBack(): void;
  onSelected(selected: Set<string>): void;
  onImport(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <AppDialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.skills.importTitle")}</DialogTitle>
          <DialogDescription>{t("settings.skills.description")}</DialogDescription>
        </DialogHeader>
        <AppDialogBody className="space-y-3 py-4">
          {preview ? (
            <>
              <Button onClick={onBack} size="sm" variant="ghost">
                <ArrowLeft />
                {t("settings.skills.back")}
              </Button>
              <div className="divide-y rounded-lg ring-1 ring-foreground/10">
                {preview.candidates.map((candidate) => {
                  const actionable = actionableCandidate(candidate);
                  return (
                    <label className="flex min-h-14 items-center gap-3 px-3 py-2" key={candidate.ref}>
                      <input
                        checked={selected.has(candidate.ref)}
                        className="size-4 accent-foreground"
                        disabled={busy || !actionable}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(candidate.ref);
                          else next.delete(candidate.ref);
                          onSelected(next);
                        }}
                        type="checkbox"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-sm">{candidate.displayName}</span>
                        <span className="block truncate text-muted-foreground text-xs">
                          {candidate.reason
                            ? skillReasonText(t, candidate.reason)
                            : candidate.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="divide-y rounded-lg ring-1 ring-foreground/10">
              {sources.map((source) => (
                <button
                  className="flex min-h-14 w-full items-center justify-between px-3 text-left hover:bg-muted/60 disabled:opacity-50"
                  disabled={busy || source.status === "not-installed"}
                  key={source.source}
                  onClick={() => onOpenSource(source.source as ManagedSkillAgent)}
                  type="button"
                >
                  <span>{t(`settings.skills.backend.${source.source}`)}</span>
                  <span className="text-muted-foreground text-xs">{source.actionable}</span>
                </button>
              ))}
              <button
                className="flex min-h-14 w-full items-center gap-2 px-3 text-left hover:bg-muted/60"
                disabled={busy}
                onClick={() => onOpenSource("local-folder")}
                type="button"
              >
                <FolderOpen className="size-4" />
                {t("settings.skills.localFolder")}
              </button>
            </div>
          )}
        </AppDialogBody>
        <DialogFooter>
          {preview && (
            <Button disabled={busy || selected.size === 0} onClick={onImport}>
              {t("settings.skills.importSelected", { count: selected.size })}
            </Button>
          )}
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
