/**
 * [INPUT]: Depends on React state, Library import client commands, main-authored snapshots/plans, and Skills translations
 * [OUTPUT]: Provides useSkillImport with a shared source/candidate dialog controller and an optional post-import snapshot callback
 * [POS]: Personal-Library acquisition flow shared by global and Project settings; it never changes an Extension's owner scope
 */

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  applyUnifiedSkillPlan,
  chooseLocalSkillsFolder,
  listUnifiedSkillCandidates,
  listUnifiedSkills,
  previewUnifiedSkillIntents,
} from "@/lib/unified-skills-client";
import type {
  ManagedSkillAgent,
  ManagedSkillImportPreview,
  UnifiedSkillsSnapshot,
} from "../../../../../shared/unified-skills-ipc";
import type { SkillImportDialog } from "../skill-import-dialog";
import { actionableCandidate, skillErrorText, skillReasonText } from "../skill-text";

type ImportSource = ManagedSkillAgent | "local-folder";
const discover = (source: ImportSource) => source === "local-folder"
  ? chooseLocalSkillsFolder()
  : listUnifiedSkillCandidates(source, true);

export function useSkillImport({
  snapshot,
  onImported,
}: {
  snapshot?: UnifiedSkillsSnapshot | null;
  onImported?(snapshot: UnifiedSkillsSnapshot): void;
} = {}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [loadedSnapshot, setLoadedSnapshot] = useState<UnifiedSkillsSnapshot | null>(null);
  const [preview, setPreview] = useState<ManagedSkillImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const currentSnapshot = snapshot ?? loadedSnapshot;
  const ready = currentSnapshot?.availability.kind === "ready";

  useEffect(() => () => { sequence.current += 1; }, []);

  const reset = () => {
    sequence.current += 1;
    setBusy(false);
    setError("");
    setPreview(null);
    setSelected(new Set());
  };
  const changeOpen = (value: boolean) => {
    reset();
    setOpen(value);
  };
  const acceptPreview = (value: ManagedSkillImportPreview | null) => {
    if (!value) return;
    setPreview(value);
    setSelected(new Set(value.candidates.filter(actionableCandidate).map((item) => item.ref)));
  };
  const run = async <T,>(
    operation: (current: () => boolean) => Promise<T>,
    accept: (value: T) => void
  ) => {
    const request = ++sequence.current;
    const current = () => request === sequence.current;
    setBusy(true);
    setError("");
    try {
      const value = await operation(current);
      if (current()) accept(value);
    } catch (cause) {
      if (current()) setError(skillErrorText(t, cause));
    } finally {
      if (current()) setBusy(false);
    }
  };

  const openDialog = (source?: ImportSource) => {
    changeOpen(true);
    return run(async (current) => {
      const value = snapshot ?? await listUnifiedSkills();
      const candidates = source && value.availability.kind === "ready" && current()
        ? await discover(source)
        : null;
      return { value, candidates };
    }, ({ value, candidates }) => {
      setLoadedSnapshot(value);
      acceptPreview(candidates);
    });
  };

  const importSelected = () => {
    if (!ready || !preview || !selected.size) return;
    void run(async (current) => {
      const plan = await previewUnifiedSkillIntents([{
        type: "import-and-enable",
        previewId: preview.previewId,
        revision: preview.revision,
        candidateRefs: [...selected],
      }]);
      if (!current()) return null;
      if (plan.consent.length) throw new Error("Skill import requires unexpected destructive consent");
      return applyUnifiedSkillPlan({
        planId: plan.planId,
        planDigest: plan.planDigest,
        authorityToken: plan.authorityToken,
      });
    }, (value) => {
      if (!value) return;
      onImported?.(value);
      changeOpen(false);
    });
  };

  const readOnly = currentSnapshot?.availability.kind === "read-only"
    ? `${t("settings.skills.readOnly")}: ${skillReasonText(t, currentSnapshot.availability.reason)}`
    : "";
  const dialogProps: ComponentProps<typeof SkillImportDialog> = {
    open,
    sources: currentSnapshot?.sources ?? [],
    preview,
    selected,
    busy: busy || !ready,
    error: error || readOnly,
    onOpenChange: changeOpen,
    onOpenSource: (source) => {
      if (ready) void run(() => discover(source), acceptPreview);
    },
    onBack: reset,
    onSelected: setSelected,
    onImport: importSelected,
  };
  return { busy, openDialog, dialogProps };
}
