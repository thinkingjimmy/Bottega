/**
 * [INPUT]: Depends on the Codex runtime registry, SkillsCatalog path, projections, Codex app-server/service/0600 rule store and workspace/userData/home roots
 * [OUTPUT]: Provides createCodexSkillsService, completes the control process, private rules and the stateless installation and initialization of runtime/catalog adapters
 * [POS]: The Codex Skills composition module for startup; The index only has returning lifecycle owners, and does not reveal details of vendor connections
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendRuntimeRegistry } from "../backends";
import { CodexSkillsAppServer } from "../backends/codex/skills-app-server";
import { CodexSkillsRuleStore } from "../backends/codex/skills-rule-store";
import { CodexSkillsService } from "../backends/codex/skills-service";
import type { SkillsCatalog } from "../skills-catalog";

type CodexSkillsRuntimeDependencies = Readonly<{
  userData: string;
  userHome: string;
  workspace: string;
  catalog: SkillsCatalog;
}>;

export async function createCodexSkillsService({
  userData,
  userHome,
  workspace,
  catalog,
}: CodexSkillsRuntimeDependencies) {
  const service = new CodexSkillsService({
    store: new CodexSkillsRuleStore(userData),
    native: new CodexSkillsAppServer({
      workspace: join(tmpdir(), "bottega-codex-skills"),
      controlRoot: join(userData, "codex-skills-control"),
      readOnlyRoots: [join(userHome, ".agents", "skills"), "/etc/codex/skills"],
    }),
    cwd: workspace,
    resolveRuntime: async () => {
      const snapshot = await backendRuntimeRegistry.resolve("codex");
      return snapshot.runtimeStatus === "installed"
        ? { kind: "installed", runtime: snapshot.runtime }
        : {
            kind: "unavailable",
            reason:
              snapshot.reason ??
              `Codex runtime 状态为 ${snapshot.runtimeStatus}`,
          };
    },
    catalogPaths: () => catalog.listedPaths({ kind: "default" }),
  });
  await service.initialize();
  return service;
}
