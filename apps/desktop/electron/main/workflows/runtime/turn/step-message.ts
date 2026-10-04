/**
 * [INPUT]: Depends on the Chat message byte limit, cutUtf8 from the workflow projection, and the run's EvidenceStore (put / pathOf).
 * [OUTPUT]: Provides stepPrompt (a step's instructions with its inputs inline) and assembleStepMessage: the whole next-step message within one Chat message in UTF-8 bytes — the configuration's instructions, the prompt, prior results and (for review) the evidence — handing any input that does not fit as a read-only file by path and digest with a bounded excerpt (A2-04).
 * [POS]: The one place a workflow turn's message is budgeted; the executor dispatches what this returns and grants the store's directory as a read-only root when anything was handed by file.
 */
import { MESSAGE_BYTE_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import { cutUtf8 } from "@ai-chat/cloud-protocol/workflows/projection";
import type { EvidenceStore } from "../../evidence";

/** Room left for the transport's own framing. */
const PROMPT_MARGIN = 256;
/** What review's evidence always gets: enough for its own stored-by-reference fallback. */
const EVIDENCE_RESERVE = 1_024;
/** How much of a handed input stays inline as its beginning. */
const EXCERPT_BYTES = 1_024;
const FIELDS = [["task", "Task"], ["acceptanceCriteria", "Acceptance criteria"], ["plan", "Accepted plan"], ["implementation", "Implementation"]] as const;
const TASKS: Record<WorkflowRoleName, string> = { plan: "Write the implementation plan for this task. Do not change any files.",
  develop: "Implement the accepted plan in this workspace.",
  review: "Review the implementation against the acceptance criteria and the plan. Do not change any files." };
const CLOSING = "\n\nWhen you are done, call submit_step_result once with your full result.";
const bytes = (value: string) => Buffer.byteLength(value);

/** The step's instructions: what to do, what to read, and to report once through submit_step_result. */
export function stepPrompt(role: WorkflowRoleName, args: Readonly<Record<string, unknown>>) {
  return compose(role, FIELDS.flatMap(([key, label]) => typeof args[key] === "string" && args[key] ? [{ label, text: args[key] as string }] : []));
}
function compose(role: WorkflowRoleName, sections: readonly { label: string; text: string }[]) {
  return `${TASKS[role]}${sections.map(section => `\n\n## ${section.label}\n${section.text}`).join("")}${CLOSING}`;
}

/**
 * A2-04: the message as the turn will carry it — `instructions\n\n` + prompt (+ evidence for review) — within one Chat message.
 * The largest input is handed by file first, until the rest fits beside the evidence's reserve; a handed input is the whole text,
 * never a cut, read-only at a path with its digest, and its beginning stays inline. Evidence then takes what is left.
 */
export async function assembleStepMessage(input: { role: WorkflowRoleName; args: Readonly<Record<string, unknown>>; instructions: string | null;
  store: Pick<EvidenceStore, "put" | "pathOf">; evidence?(budget: number): Promise<string> }): Promise<{ prompt: string; handed: boolean }> {
  const limit = MESSAGE_BYTE_LIMIT - PROMPT_MARGIN - (input.instructions ? bytes(input.instructions) + 2 : 0);
  const reserve = input.evidence ? EVIDENCE_RESERVE : 0;
  const sections = FIELDS.flatMap(([key, label]) => typeof input.args[key] === "string" && input.args[key] ? [{ label, text: input.args[key] as string, handed: false }] : []);
  while (bytes(compose(input.role, sections)) + reserve > limit) {
    const largest = sections.filter(section => !section.handed).sort((a, b) => bytes(b.text) - bytes(a.text))[0];
    if (!largest) throw new Error("workflow-step-message-budget");
    const whole = await input.store.put(largest.text);
    largest.text = `${largest.label} is ${bytes(largest.text)} bytes, too long to include here. Read all of it with your file-reading tool at `
      + `${input.store.pathOf(whole.ref)} — it is read-only, and what you read must match ${whole.digest}. It begins:\n\n${cutUtf8(largest.text, EXCERPT_BYTES)}\n…`;
    largest.handed = true;
  }
  const prompt = compose(input.role, sections);
  const evidence = input.evidence ? await input.evidence(limit - bytes(prompt) - 2) : null;
  const message = evidence ? `${prompt}\n\n${evidence}` : prompt;
  if (bytes(message) > limit) throw new Error("workflow-step-message-budget");
  return { prompt: message, handed: sections.some(section => section.handed) };
}
