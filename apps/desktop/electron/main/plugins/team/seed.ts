/**
 * [INPUT]: Unified native manifest validation, canonical public Provider identity values, bounded main error vocabulary and host-owned seed directory.
 * [OUTPUT]: Complete editable official team source and optional first-revision build recovery after a durable failed catalog receipt.
 * [POS]: Production feature package seed; main RPC retains only persistent session/custody and durable feature services.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { officialToolPlugins } from "../../../../shared/plugin-tools";
import { unifiedPluginManifestSchema } from "@bottega/contracts/plugins/platform";
import { BUILTIN_PROVIDER_IDS } from "@bottega/contracts/model/provider-capabilities";
import type { UnifiedPluginPlatform } from "../platform/service";
import { errorMessage } from "../../ipc/errors";
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const tools = [
  ["team_create", "Create a persistent team for this Lead Chat and its Project.", object({})],
  ["team_add_member", "Create a named persistent member. Blank context is the default; optional fork uses a completed Chat prefix.", object({
    name: string, providerId: { enum: Object.values(BUILTIN_PROVIDER_IDS) }, task: string, memberId: string,
    forkChatId: string, isolation: { enum: ["shared", "worktree"] },
  }, ["name", "providerId", "task"])],
  ["team_send", "Send one stable-identity message to a member or lead. Delivery is separate from processing.", object({ memberId: string, body: string, messageId: string }, ["memberId", "body"])],
  ["team_inbox", "Claim pending team messages once. Check this between steps; acknowledge after processing.", object({})],
  ["team_ack", "Explicitly acknowledge processed messages with the exact consumption identity.", object({ ids: { type: "array", items: string }, consumptionId: string }, ["ids", "consumptionId"])],
  ["team_create_task", "Create a shared task with optional owner and dependency identities.", object({ title: string, description: string, ownerMemberId: { type: ["string", "null"] }, dependencies: { type: "array", items: string } }, ["title"])],
  ["team_update_task", "Update a task using its exact current version. Completion is an explicit result.", object({ taskId: string, expectedVersion: { type: "integer", minimum: 1 }, status: { enum: ["todo", "in-progress", "blocked", "done", "cancelled"] },
    ownerMemberId: { type: ["string", "null"] }, dependencies: { type: "array", items: string } }, ["taskId", "expectedVersion"])],
  ["team_stop_member", "Stop a member and release its pending task ownership after confirmed cleanup.", object({ memberId: string }, ["memberId"])],
  ["team_state", "Read the current team, members, tasks and message delivery/processing states.", object({})],
  ["team_worktree_status", "Inspect isolated member commits and durable result merge receipts before merging.", object({ memberId: string }, ["memberId"])],
  ["team_merge_member", "Merge a stopped isolated member result with exact Project HEAD and task-version checks. Conflicts stay isolated.", object({ memberId: string, taskId: string,
    expectedVersion: { type: "integer", minimum: 1 }, expectedHead: string, operationId: string, message: string }, ["memberId", "taskId", "expectedVersion", "expectedHead"])],
  ["team_stop", "Stop every member and retain team Chats and task records for later review.", object({})],
] as const;
export const OFFICIAL_TEAM_MANIFEST = unifiedPluginManifestSchema.parse({
  schemaVersion: 1, id: "team", name: "Team", version: "1.0.0", providerAlias: "team",
  description: "Persistent Agent members, direct messages and a versioned shared task board.",
  source: { kind: "official", format: "bottega", editable: true },
  slots: { declares: [], injects: [{ slot: "main.pages", ownerPluginId: "host" }] },
  contributions: [
    { kind: "service", id: "service", name: "Team sessions", entry: "src/service.ts" },
    { kind: "page", id: "panel", name: "Teams", entry: "src/panel.ts", slot: "main.pages", navigation: { label: "Teams", icon: "UsersThree" } },
    ...tools.map(([id, description, inputSchema]) => ({ kind: "tool" as const, id, name: id, description, inputSchema,
      outputSchema: { type: "object" }, executor: { kind: "process" as const, entry: "src/service.ts", method: id },
      timeoutMs: 60_000, access: id === "team_state" || id === "team_inbox" || id === "team_worktree_status" ? "read" as const : "write" as const, planAllowed: id === "team_state" || id === "team_worktree_status" })),
    { kind: "mode", id: "team", name: "Team", description: "Work with persistent members and a shared task board.",
      prompt: "Work as a persistent team. The Lead uses team_create in the selected Project and creates named members with short precise tasks. Managed members perform their assigned task and collaborate with their Lead; they do not create nested teams. Blank context is the default; choose a context fork only when needed. Members continue after the Lead reply. Use team_send for direct collaboration, team_inbox between steps, team_state for delivery/consumption identities and team_ack only after processing. Keep task owners/dependencies current and report completion explicitly. Unknown delivery must not be resent automatically. Shared workspaces can have simultaneous writes; choose worktree isolation for controlled parallel writes.",
      tools: { plugins: ["team", ...officialToolPlugins.map(plugin => plugin.id)], tools: [] },
      nativeRequirements: { persistentSessions: true }, strategy: { team: true } },
  ],
});
export async function ensureTeamPluginSource(userData: string) {
  const sourceDirectory = join(userData, "plugin-official", "team", "source");
  const files: Record<string, string> = {
    "bottega.plugin.json": JSON.stringify(OFFICIAL_TEAM_MANIFEST, null, 2) + "\n",
    "src/service.ts": tools.map(([id]) => "export async function " + id + "(input, context) { return context.api.call('team." + id.slice(5).replaceAll("_", "-") + "', input); }").join("\n") +
      "\nexport async function prepare(){ return { activate(){}, drain(){}, dispose(){} }; }\n",
    "src/panel.ts": PANEL,
    "src/styles.css": "body{margin:0;background:var(--background);color:var(--foreground);font:14px system-ui}main{padding:24px}button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 14px;cursor:pointer}article{padding:16px;margin:16px 0;border:1px solid var(--border);border-radius:12px}p{line-height:1.5}pre{white-space:pre-wrap}\n",
    "README.md": "# Team\n\nOne native package provides persistent members, direct messaging, a shared task board, a page and an Agent mode. Create a personal copy to change its prompts, tools or presentation. Messages keep delivery and processing separate. Shared workspaces show a concurrent-write warning.\n",
  };
  for (const [path, content] of Object.entries(files)) {
    const target = join(sourceDirectory, path); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const prior = await readFile(target, "utf8").catch(() => null);
    if (prior !== content) await writeFile(target, content, { mode: 0o600 });
  }
  return { manifest: OFFICIAL_TEAM_MANIFEST, sourceDirectory, packageDirectory: sourceDirectory };
}
export async function prepareTeamPluginRevision(input: {
  platform: Pick<UnifiedPluginPlatform, "activeRevision" | "get">;
  rebuild(pluginId: string): Promise<unknown>;
  reportError(error: unknown): void;
}): Promise<void> {
  if (input.platform.activeRevision("team")) return;
  try { await input.rebuild("team"); }
  catch (error) {
    const record = input.platform.get("team");
    if (!record || !["failed", "unavailable"].includes(record.status) || record.runtimeReady || record.error !== errorMessage(error).slice(0, 2048)) throw error;
    input.reportError(error);
  }
}
const PANEL = `export default function TeamPanel(){
 const root=document.createElement('main'),heading=document.createElement('h1'),hint=document.createElement('p'),button=document.createElement('button'),content=document.createElement('section');
 heading.textContent='Teams';hint.textContent='Use Team mode in a Project to create members. Delivery and task completion are separate.';button.textContent='Refresh teams';root.append(heading,hint,button,content);
 button.onclick=async()=>{button.disabled=true;content.replaceChildren();try{const result=await window.bottega.call('team_state',{});for(const team of result.teams??[]){const card=document.createElement('article'),title=document.createElement('h2'),members=document.createElement('p'),tasks=document.createElement('p');title.textContent=team.leadChatId+' · '+team.status;members.textContent=team.members.map(member=>member.name+': '+member.status).join(' · ');tasks.textContent=team.tasks.map(task=>task.title+': '+task.status).join(' · ');card.append(title,members,tasks);content.append(card);}if(!content.childNodes.length)content.textContent='No teams yet.';}catch(error){content.textContent=String(error);}finally{button.disabled=false;}};
 return root;
}\n`;
