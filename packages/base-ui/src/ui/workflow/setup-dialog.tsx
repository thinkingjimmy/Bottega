/**
 * [INPUT]: Depends on the shared Dialog/StepDialog/DialogChoice/Select/Button primitives, the workflow setup port and
 *          workbench-copy.
 * [OUTPUT]: Provides WorkflowSetupDialog — the one four-step dialog for turning a workflow on and editing it (U02/U07):
 *           choose a workflow → who does each step → what changes in your Base → check and turn on.
 * Localizes built-in recipe names by stable recipe id.
 * [POS]: Opened from Base ⋯, a row's ▶ and Project settings › Workflows alike (Q3/Q33). New walks Back / Continue; Edit turns
 *        the steps into tabs with Save always at the bottom (Q41). The host's port does every read and write; the host passes the
 *        Base's live shape, and step 3 says what it gets (the board, or why not), stops when there is no room, and says when the
 *        Base's columns changed while it was open (BAS-06).
 */
import { workflowRecipeName } from "@ai-chat/ui/lib/workbench-copy";
import { useEffect, useMemo, useState } from "react";
import { CheckIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DialogChoice, StepDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { formatWorkbench, pluralWorkbench } from "@ai-chat/ui/lib/workbench-copy";
import { cn } from "@ai-chat/ui/lib/utils";
import { useWorkflowCopy } from "../chrome/workflow-column";
import { useAppTranslation } from "../platform/i18n";
import { baseHasRoom, displaySteps, type RoleCandidate, type WorkflowBaseShape, type WorkflowRecipeView, type WorkflowRoleName, type WorkflowStepView, type WorkflowSetupInput, type WorkflowSetupPort } from "./port";

type Stage = "workflow" | "who" | "base" | "check";
const STAGES: readonly Stage[] = ["workflow", "who", "base", "check"];

export type WorkflowSetupStage = Stage;
export function WorkflowSetupDialog({ port, editing, baseShape, initialStage = "workflow", onOpenChange }: {
  port: WorkflowSetupPort;
  /** Present when editing a binding; its steps become tabs and the primary action is Save. */
  editing?: WorkflowSetupInput;
  /** What turning the workflow on does to the Base, from its live meta (BAS-06): the columns shown in "Now", room, the board. */
  baseShape: WorkflowBaseShape;
  /** Editing opens on this tab, e.g. Who does what when a blocked step asks for another config. */
  initialStage?: Stage;
  onOpenChange(open: boolean): void;
}) {
  const { t, i18n } = useAppTranslation();
  const workbench = useWorkflowCopy(), copy = workbench.setup, roleCopy = workbench.agentConfigs;
  const [stage, setStage] = useState<Stage>(editing ? initialStage : "workflow");
  /* The Base structure step 3 first showed on this visit; a later difference is said, never silently swapped (Q13). */
  const [shownStructure, setShownStructure] = useState(stage === "base" ? baseShape.structureKey : null);
  const go = (next: Stage) => { setStage(next); if (next === "base") setShownStructure(baseShape.structureKey); };
  const room = baseHasRoom(baseShape);
  // What step 3 says it adds counts what the Base does not have yet; an Edit with both columns adds nothing.
  const baseIntro = baseShape.columnsNeeded ? pluralWorkbench(copy, "baseIntro", i18n.language, baseShape.columnsNeeded) : copy.baseIntroEditing;
  // `count` is how many columns the person has to remove, not how many the workflow adds.
  const roomLine = pluralWorkbench(copy, "baseFull", i18n.language, baseShape.columnCount + baseShape.columnsNeeded - baseShape.columnLimit,
    { existing: baseShape.columnCount, limit: baseShape.columnLimit });
  const [recipes, setRecipes] = useState<readonly WorkflowRecipeView[]>([]);
  const [recipeId, setRecipeId] = useState(editing?.recipe.recipeId ?? "");
  const [roles, setRoles] = useState<Partial<Record<WorkflowRoleName, string>>>(() =>
    editing ? Object.fromEntries(Object.entries(editing.roles).map(([role, value]) => [role, value.configId])) : {});
  const [candidates, setCandidates] = useState<Partial<Record<WorkflowRoleName, readonly RoleCandidate[]>>>({});
  // Each check answers one input: a result for an older input is simply not this input's check (no reset needed).
  const [checked, setChecked] = useState<{ key: string; result: Awaited<ReturnType<WorkflowSetupPort["check"]>> } | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const recipe = recipes.find(item => item.recipeId === recipeId) ?? null;
  const steps = useMemo(() => recipe ? displaySteps(recipe) : [], [recipe]);
  const agentRoles = steps.flatMap(step => step.kind === "agent" ? [step.role] : []);

  useEffect(() => {
    let live = true;
    void port.recipes().then(list => { if (!live) return; setRecipes(list); setRecipeId(current => current || list[0]?.recipeId || ""); });
    return () => { live = false; };
  }, [port]);
  useEffect(() => {
    let live = true;
    void Promise.all(agentRoles.map(role => port.candidates(role))).then(lists => {
      if (!live) return;
      setCandidates(Object.fromEntries(agentRoles.map((role, index) => [role, lists[index]!])));
      /* A new setup fills each role in step order with an admitted config, preferring one no earlier role took, so three
         roles do not all default to the first config; editing keeps what was chosen. */
      setRoles(current => {
        const next = { ...current }, used = new Set(Object.values(next));
        agentRoles.forEach((role, index) => {
          if (next[role]) return;
          const admitted = lists[index]!.filter(item => item.available);
          next[role] = (admitted.find(item => !used.has(item.configId)) ?? admitted[0])?.configId;
          if (next[role]) used.add(next[role]!);
        });
        return next;
      });
    });
    return () => { live = false; };
  }, [port, agentRoles.join(",")]);

  const input: WorkflowSetupInput | null = recipe && agentRoles.every(role => roles[role]) ? {
    bindingId: editing?.bindingId ?? null, recipe: { recipeId: recipe.recipeId, version: recipe.version },
    roles: Object.fromEntries(agentRoles.map(role => [role, { configId: roles[role]! }])) as WorkflowSetupInput["roles"],
    columnNames: { stage: copy.stageColumn, acceptanceCriteria: copy.acceptanceColumn, boardView: copy.boardView },
  } : null;
  /* The check is the real preflight (E-03): it gates Turn on and, when editing, Save on every tab. */
  const inputKey = JSON.stringify(input);
  const check = checked?.key === inputKey ? checked.result : null;
  useEffect(() => {
    if ((stage !== "check" && !editing) || !input) return;
    let live = true;
    void port.check(input).then(result => { if (live) setChecked({ key: inputKey, result }); });
    return () => { live = false; };
  }, [stage, Boolean(editing), inputKey]);

  const ready = Boolean(input && room && check?.online && check.items.every(item => item.ok));
  const save = async () => {
    if (!input || busy) return;
    setBusy(true); setFailed(false);
    try { await port.save(input); onOpenChange(false); } catch { setFailed(true); } finally { setBusy(false); }
  };
  const index = STAGES.indexOf(stage);
  // A Base without room stops on step 3, where the line says what to do; step 4 could only refuse.
  const canContinue = stage === "workflow" ? Boolean(recipe) : stage === "who" ? Boolean(input) : stage === "base" ? room : true;
  const configName = (role: WorkflowRoleName) => candidates[role]?.find(item => item.configId === roles[role])?.name ?? "—";
  const stepLabel = (step: WorkflowStepView) => step.kind === "agent"
    ? { plan: copy.stepPlan, develop: copy.stepDevelop, review: copy.stepReview }[step.role]
    : step.kind === "confirm-plan" ? copy.stepConfirm : copy.stepDecide;
  const stepDescription = (step: WorkflowStepView) => step.kind === "agent"
    ? { plan: copy.stepPlanDescription, develop: copy.stepDevelopDescription, review: copy.stepReviewDescription }[step.role]
    : step.kind === "confirm-plan" ? copy.stepConfirmDescription : copy.stepDecideDescription;
  const titles: Record<Stage, string> = { workflow: copy.chooseTitle, who: copy.whoTitle, base: copy.baseTitle, check: copy.checkTitle };
  const tabs: Record<Stage, string> = { workflow: copy.tabWorkflow, who: copy.tabWho, base: copy.tabBase, check: copy.tabCheck };

  const cancel = <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>;
  const primary = editing
    ? <Button type="button" disabled={!ready || busy} onClick={() => void save()}>{t("common.save")}</Button>
    : stage === "check"
      ? <Button type="button" disabled={!ready || busy} onClick={() => void save()}>{copy.turnOn}</Button>
      : <Button type="button" disabled={!canContinue} onClick={() => go(STAGES[index + 1]!)}>{copy.continue}</Button>;
  const back = !editing && index > 0
    ? <Button type="button" variant="ghost" disabled={busy} onClick={() => go(STAGES[index - 1]!)}>{copy.back}</Button> : undefined;

  return (
    <Dialog open onOpenChange={next => { if (!busy) onOpenChange(next); }}>
      <StepDialogContent
        data-workflow-setup={editing ? "edit" : "new"}
        progress={editing ? null : { index: index + 1, total: STAGES.length, label: formatWorkbench(copy.stepOf, { current: index + 1, total: STAGES.length }) }}
        title={editing ? copy.editTitle : titles[stage]}
        description={stage === "who" ? copy.whoHint : stage === "base" ? baseIntro : undefined}
        back={back}
        actions={<>{failed && <span role="alert" className="mr-1 text-destructive text-xs" data-setup-failed="">{room ? roleCopy.saveFailed : roomLine}</span>}{cancel}{primary}</>}
      >
        {editing && (
          <div className="flex gap-1 border-b pb-2" role="tablist" aria-label={copy.editTitle}>
            {STAGES.map(item => (
              <button key={item} type="button" role="tab" aria-selected={stage === item} data-setup-tab={item}
                className={cn("rounded-md px-2.5 py-1 text-xs pointer-coarse:min-h-11", stage === item ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
                onClick={() => go(item)}>{STAGES.indexOf(item) + 1} · {tabs[item]}</button>
            ))}
          </div>
        )}
        {stage === "workflow" && recipes.map(item => (
          <DialogChoice key={item.recipeId} selected={item.recipeId === recipeId} onClick={() => setRecipeId(item.recipeId)} title={workflowRecipeName(item, copy)}
            detail={<span className="flex flex-nowrap gap-1 overflow-x-auto">{displaySteps(item).map(step => <span key={step.key}
              className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]">{stepLabel(step)}</span>)}</span>} />
        ))}
        {stage === "who" && (
          <>
            <ol className="flex flex-col divide-y rounded-lg border" data-setup-steps="">
              {steps.map((step, position) => (
                <li key={step.key} className="flex items-center gap-3 px-3 py-2.5 text-sm" data-setup-step={step.key}>
                  <span className="w-4 shrink-0 text-muted-foreground text-xs tabular-nums">{position + 1}</span>
                  <span className="flex min-w-0 flex-1 flex-col"><span className="font-medium">{stepLabel(step)}</span>
                    <span className="text-muted-foreground text-xs">{stepDescription(step)}</span>
                    {/* No config can take this step: each one and why, on the row, not only inside the closed list (E-03). */}
                    {step.kind === "agent" && candidates[step.role]?.length && candidates[step.role]!.every(item => !item.available) ? (
                      <span className="flex flex-col text-amber-700 text-xs dark:text-amber-400" data-setup-role-blocked={step.role}>
                        {candidates[step.role]!.map(item => <span key={item.configId}>{item.name}: {item.reason}</span>)}
                      </span>
                    ) : null}</span>
                  {step.kind === "agent" ? (
                    <Select value={roles[step.role] ?? ""} onValueChange={configId => setRoles(current => ({ ...current, [step.role]: configId }))}>
                      <SelectTrigger className="w-44 shrink-0 pointer-coarse:h-11" aria-label={stepLabel(step)}><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {(candidates[step.role] ?? []).map(candidate => (
                          <SelectItem key={candidate.configId} value={candidate.configId} disabled={!candidate.available}>
                            <span className="flex flex-col"><span>{candidate.name}</span>
                              {!candidate.available && candidate.reason ? <span className="text-muted-foreground text-xs">{candidate.reason}</span> : null}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : <span className="w-44 shrink-0 text-muted-foreground text-xs">{copy.you}</span>}
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground text-xs">{copy.whoGreyedHint}</p>
          </>
        )}
        {stage === "base" && (
          <div className="flex flex-col gap-3 text-sm">
            {shownStructure !== null && shownStructure !== baseShape.structureKey && (
              <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs" role="status" data-setup-changed="">{copy.baseChanged}</p>
            )}
            <ColumnStrip label={copy.baseNow} names={baseShape.columnNames.slice(0, 3)} />
            {/* Only what the Base does not have yet is added; editing a Base that has both columns shows no After. */}
            {baseShape.columnsNeeded > 0 && <>
              <ColumnStrip label={copy.baseAfter} names={baseShape.columnNames.slice(0, 3)}
                added={baseShape.missing.map(role => role === "stage" ? copy.stageColumn : copy.acceptanceColumn)} />
              <p className="font-medium" data-setup-new-columns="">{pluralWorkbench(copy, "baseNewColumns", i18n.language, baseShape.columnsNeeded)}</p>
            </>}
            <ul className="flex flex-col gap-1.5 text-xs">
              <li><span className="inline-flex items-center gap-1 font-medium"><LockIcon aria-hidden className="size-3" />{copy.stageColumn}</span> — {copy.stageDescription}</li>
              <li><span className="font-medium">{copy.acceptanceColumn}</span> — {copy.acceptanceDescription}</li>
            </ul>
            <p className="text-muted-foreground text-xs">{copy.baseOthersUnchanged} {copy.baseFixedColumns}</p>
            {baseShape.board !== "none" && <p className="text-xs" data-setup-board={baseShape.board}>
              {formatWorkbench(baseShape.board === "added" ? copy.baseBoardAdded : copy.baseBoardNoRoom, { view: copy.boardView, limit: baseShape.viewLimit })}</p>}
            {!room && <p className="flex items-start gap-1.5 text-xs" role="alert" data-setup-room="">
              <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0 text-amber-600" />{roomLine}</p>}
          </div>
        )}
        {stage === "check" && (
          <div className="flex flex-col gap-3 text-sm" data-setup-check="">
            <ul className="flex flex-col gap-1">
              {steps.map(step => <li key={step.key} className="flex justify-between gap-3"><span>{stepLabel(step)}</span>
                <span className="text-muted-foreground">{step.kind === "agent" ? configName(step.role) : step.kind === "decide" ? copy.youDecide : copy.youConfirm}</span></li>)}
              <li className="flex justify-between gap-3"><span>{copy.baseGets}</span><span className="text-muted-foreground">{copy.stageColumn}, {copy.acceptanceColumn}</span></li>
            </ul>
            {!check ? <p className="text-muted-foreground text-xs" role="status" data-setup-checking="">{copy.checking}</p> : !check.online ? (
              <p className="flex items-center gap-1.5 text-xs" role="status"><TriangleAlertIcon aria-hidden className="size-3.5" />{formatWorkbench(copy.needsComputer, { computer: check.computer })}</p>
            ) : (
              <>
              <p className="text-muted-foreground text-xs">{formatWorkbench(copy.checkedOn, { computer: check.computer })}</p>
              <ul className="flex flex-col gap-1 text-xs">
                {[...check.items, ...(baseShape.columnsNeeded ? [{ label: room ? pluralWorkbench(copy, "baseHasRoom", i18n.language, baseShape.columnsNeeded) : roomLine, ok: room }] : [])].map(item => (
                  <li key={item.label} className="flex items-start gap-1.5">
                    {item.ok ? <CheckIcon aria-hidden className="mt-px size-3.5 text-emerald-600" /> : <TriangleAlertIcon aria-hidden className="mt-px size-3.5 text-amber-600" />}
                    {item.label}
                  </li>
                ))}
              </ul>
              </>
            )}
          </div>
        )}
      </StepDialogContent>
    </Dialog>
  );
}

function ColumnStrip({ label, names, added = [] }: { label: string; names: readonly string[]; added?: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="flex flex-nowrap gap-1 overflow-x-auto">
        {names.map(name => <span key={name} className="shrink-0 rounded border px-1.5 py-0.5 text-xs">{name}</span>)}
        {added.map(name => <span key={name} className="shrink-0 rounded border border-dashed bg-muted px-1.5 py-0.5 font-medium text-xs" data-column-added="">{name}</span>)}
      </span>
    </div>
  );
}
