/**
 * [INPUT]: Depends on persisted AppDomainIdentity, generation-bound frozen effective capability, active App root bounded skill
 * [OUTPUT]: Provides bounded live skill scanning with closed AppInstructionContributorRegistry; Use chat/Base UI escape path and skill in packet direct reading path
 * [POS]: The main-only Agent instructions shell of apps; All Base shares common common contributor
 */

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import type { AppDomainIdentity } from "../../../../shared/apps-ipc";
import type { FrozenAppReferenceCapability } from "../../../../shared/app-lifecycle";
import type { BaseToolsAvailability } from "../../../../shared/builtin-tools";
import { allocateAppInstructions } from "./grant-budget";
import { parseSkillFrontmatter } from "../../skills-catalog";

export const APP_SKILL_ENTRY_LIMIT = 8;
const APP_SKILL_FILE_LIMIT = 128 * 1024;

export type AppSkillEntry = Readonly<{
  name: string;
  path: string;
  description: string;
}>;

export type AppInstructionContext = Readonly<{
  appId: string;
  appName: string;
  generationId: string;
  referenceLeaseId: string;
  capability: FrozenAppReferenceCapability;
  /** 本轮 builtin tool access 是否为 mutate；Plan 与只读 runtime 都会把它压成 false */
  mutationsAllowed: boolean;
  baseToolsAvailability?: BaseToolsAvailability;
  skillEntries: readonly AppSkillEntry[];
}>;

export type AppInstructionProjection =
  | Readonly<{
      kind: "instruction";
      text: string;
      degradedReason?:
        | "base-reads-disabled"
        | "base-row-mutations-disabled";
    }>
  | Readonly<{ kind: "omitted"; reason: "base-tools-disabled" }>;

export type AppInstructionContributor = (
  context: AppInstructionContext
) => AppInstructionProjection;

export class AppInstructionContributorRegistry {
  private readonly registered = new Map<string, AppInstructionContributor>();

  constructor() {
    this.registered.set("base/ordinary", (context) => {
      /* grant 说「可以写」不等于本轮真的签发了写工具：Plan 与只读 runtime 都会
         把工具压成只读，文案若还说可写，就是在教 Agent 调一个不存在的工具。 */
      const grantWrites = context.capability.data === "base-row-write";
      const availability =
        context.baseToolsAvailability ??
        (context.mutationsAllowed ? "read-write" : "read-only");
      /* 指令只能来自「grant ∩ 本轮真实签发工具」。只读 grant
         遇上 write-only 工具时交集是空，不是「Base reads only」。 */
      if (availability === "none" || (availability === "write-only" && !grantWrites)) {
        return { kind: "omitted", reason: "base-tools-disabled" };
      }
      if (availability === "write-only" && grantWrites) {
        return {
          kind: "instruction",
          degradedReason: "base-reads-disabled",
          text: withSkillEntries(`Attached App ${context.appName} (${context.appId}) is an ordinary Base. Base row mutations only, reads disabled. Use target "app:${context.appId}" for row mutations. View/column changes are unavailable (403): route them to that App's Use chat or the Base UI.`, context),
        };
      }
      const writable = availability === "read-write" && grantWrites;
      return {
        kind: "instruction",
        ...(writable
          ? {}
          : { degradedReason: "base-row-mutations-disabled" as const }),
        text: withSkillEntries(
          writable
            ? `Attached App ${context.appName} (${context.appId}) is an ordinary Base. Use target "app:${context.appId}" for Base reads and row mutations. This attachment cannot change views or columns (such calls return 403): to add or edit views (e.g. a Chart view), tell the user to open that App and ask in its Use chat, or add the view manually in the Base UI. The current chat's own Base (no target) is not restricted by this.`
            : `Attached App ${context.appName} (${context.appId}) is an ordinary Base. Use target "app:${context.appId}" for Base reads only. Row, view and column mutations are all unavailable through this attachment: for changes, tell the user to open that App and ask in its Use chat, or edit manually in the Base UI.`,
          context
        ),
      };
    });
  }

  /* no-data 没有 contributor，因此天然不产生 instructions；它不是「被预算省略」，
     调用方不该把它混进不可见清单。 */
  project(input: {
    apps: readonly {
      identity: AppDomainIdentity;
      context: AppInstructionContext;
    }[];
  }) {
    const projected = input.apps.flatMap(({ identity, context }) => {
      if (identity.kind === "no-data") return [];
      const contributor = this.registered.get("base/ordinary");
      return contributor
        ? [{ appId: context.appId, projection: contributor(context) }]
        : [];
    });
    const references = projected.flatMap(({ appId, projection }) =>
      projection.kind === "instruction"
        ? [{ appId, instruction: projection.text }]
        : []
    );
    return {
      ...allocateAppInstructions(references),
      /* 有 contributor 的那批才是「本该被 Agent 看到」的集合；backend 没有
         instructions 通道时，调用方要按这张表如实报告不可见。 */
      contributingAppIds: references.map((reference) => reference.appId),
      unavailableAppIds: projected.flatMap(({ appId, projection }) =>
        projection.kind === "omitted" ? [appId] : []
      ),
      degradedApps: projected.flatMap(({ appId, projection }) =>
        projection.kind === "instruction" && projection.degradedReason
          ? [{ appId, reason: projection.degradedReason }]
          : []
      ),
    };
  }
}

function withSkillEntries(base: string, context: AppInstructionContext) {
  if (!context.capability.fileRead || !context.skillEntries.length) return base;
  return [
    base,
    ...context.skillEntries.map(
      (entry) =>
        `Live active-root App skill ${entry.name}: ${entry.description} Read ${entry.path} directly when needed; this path is not generation-fenced.`
    ),
  ].join(" ");
}

export async function collectAppSkillEntries(
  appRoot: string
): Promise<AppSkillEntry[]> {
  const canonicalRoot = await realpath(appRoot);
  const skillRoot = join(canonicalRoot, ".agents", "skills");
  const directories = await readdir(skillRoot, { withFileTypes: true }).catch(
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return [];
      throw cause;
    }
  );
  const entries: AppSkillEntry[] = [];
  for (const directory of directories.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!directory.isDirectory() || entries.length >= APP_SKILL_ENTRY_LIMIT) continue;
    const candidate = join(skillRoot, directory.name, "SKILL.md");
    const metadata = await lstat(candidate).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) continue;
    if (metadata.size > APP_SKILL_FILE_LIMIT) continue;
    const path = await realpath(candidate);
    if (relative(canonicalRoot, path).startsWith("..")) continue;
    const parsed = parseSkillFrontmatter(
      await readFile(path, "utf8"),
      directory.name
    );
    entries.push({
      name: parsed.name,
      path,
      description: parsed.description.replace(/\s+/g, " ").trim(),
    });
  }
  return entries;
}
