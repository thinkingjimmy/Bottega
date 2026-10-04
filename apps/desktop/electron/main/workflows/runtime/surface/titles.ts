/**
 * [INPUT]: Depends on Lazy five-language workbench catalogs and workflow role names.
 * [OUTPUT]: Provides Localized workflow Chat titles, step titles and workflowDefaultLabels for account configuration creation.
 * [POS]: Runtime localization without eagerly loading renderer catalogs.
 */
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";

type StepNames = { terms: { workflow: string }; agentConfigs: { planner: string; developer: string; reviewer: string };
  setup: { stepPlan: string; stepDevelop: string; stepReview: string };
  run: { confirmPlanTitle: string; confirmResultTitle: string; waitingStarted: string; reminder: string; waitingStartedResult: string; reminderResult: string } };
const CATALOGS: Record<AppLocale, () => Promise<StepNames>> = {
  en: () => import("@ai-chat/ui/lib/workbench-copy/en").then(module => module.en),
  "zh-CN": () => import("@ai-chat/ui/lib/workbench-copy/zh-cn").then(module => module.zhCN),
  ja: () => import("@ai-chat/ui/lib/workbench-copy/ja").then(module => module.ja),
  fr: () => import("@ai-chat/ui/lib/workbench-copy/fr").then(module => module.fr),
  es: () => import("@ai-chat/ui/lib/workbench-copy/es").then(module => module.es),
};
const TITLE_LIMIT = 120;

/** Localized names/instructions of the built-in defaults; their persistent identity does not depend on language. */
export async function workflowDefaultLabels(locale: AppLocale) {
  const { agentConfigs } = await (CATALOGS[locale] ?? CATALOGS.en)() as StepNames & {
    agentConfigs: { presetPlanner: string; presetDeveloper: string; presetReviewer: string } };
  return { plan: { name: agentConfigs.planner, instructions: agentConfigs.presetPlanner },
    develop: { name: agentConfigs.developer, instructions: agentConfigs.presetDeveloper },
    review: { name: agentConfigs.reviewer, instructions: agentConfigs.presetReviewer } };
}

export async function workflowChatTitle(locale: AppLocale, role: WorkflowRoleName, task: string) {
  const { setup } = await (CATALOGS[locale] ?? CATALOGS.en)();
  const step = { plan: setup.stepPlan, develop: setup.stepDevelop, review: setup.stepReview }[role];
  const title = task.trim() ? `${step} · ${task.trim().replace(/\s+/g, " ")}` : step;
  return title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title;
}

/** The task panel's marker for a workflow step's row, per role, from existing strings: "Workflow · Developer" (TASK-28). */
export async function workflowMarkerLabels(locale: AppLocale): Promise<Record<WorkflowRoleName, string>> {
  const { terms, agentConfigs } = await (CATALOGS[locale] ?? CATALOGS.en)();
  return { plan: `${terms.workflow} · ${agentConfigs.planner}`, develop: `${terms.workflow} · ${agentConfigs.developer}`,
    review: `${terms.workflow} · ${agentConfigs.reviewer}` };
}

/** The desktop reminder about a waiting confirmation (Q16), in the interface language. */
export async function confirmationNotice(locale: AppLocale, confirmation: "plan" | "result", reminder: "started" | "final-hour") {
  const { run } = await (CATALOGS[locale] ?? CATALOGS.en)();
  const plan = confirmation === "plan";
  return { title: plan ? run.confirmPlanTitle : run.confirmResultTitle,
    body: reminder === "started" ? (plan ? run.waitingStarted : run.waitingStartedResult) : (plan ? run.reminder : run.reminderResult) };
}
