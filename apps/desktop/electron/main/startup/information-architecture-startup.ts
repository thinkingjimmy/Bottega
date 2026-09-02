/**
 * [INPUT]: Depends on canonical App/Project/Base/Chat records, shared Project-to-Base navigation, and the replayable information-architecture journal/evidence builders
 * [OUTPUT]: Provides the startup migration publisher, required Project-placement authority gate, and deterministic legacy Base navigation classifier
 * [POS]: Startup IA composition seam; keeps migration publication, first-snapshot placement ordering, and legacy classification out of the Electron process root
 */

import type { AppRecord } from "../../../shared/apps-ipc";
import type { BaseMeta } from "../../../shared/bases-ipc";
import type { ChatSummary } from "../../../shared/chats-ipc";
import type { BaseNavigation } from "../../../shared/placement/facts";
import { baseNavigationForProject } from "../../../shared/placement/base";
import type { ReadonlyBaseSnapshot } from "../bases/base-store-model";
import type { StoredProject } from "../projects/store/project-store-schema";
import {
  appMigrationEvidence,
  baseMigrationEvidence,
  chatMigrationEvidence,
  completionMigrationEvidence,
  projectMigrationEvidence,
  referenceMigrationEvidence,
} from "./information-architecture-evidence";
import { InformationArchitectureMigrationJournal } from "./information-architecture-migration";

type BaseEntry = Readonly<{
  ownerKey: string;
  snapshot: ReadonlyBaseSnapshot;
}>;

type References = Readonly<{
  apps: readonly AppRecord[];
  projects: readonly StoredProject[];
  bases: readonly BaseEntry[];
  chats: readonly ChatSummary[];
}>;

type PlacementReconciliation = Readonly<{
  changed: boolean;
  affectedProjectIds: readonly string[];
}>;

export async function runRequiredProjectPlacementGate<LifecycleReport>(input: {
  recoverLifecycle(): Promise<LifecycleReport>;
  appAuthority(): "established-empty" | "established" | "degraded-corrupt";
  liveAppIds(): ReadonlySet<string>;
  reconcile(liveAppIds: ReadonlySet<string>): Promise<PlacementReconciliation>;
  publish(projectIds: readonly string[]): void;
}) {
  if (input.appAuthority() === "degraded-corrupt") {
    throw new Error(
      "AppStore authority 已降级，Project App placement 对账门禁拒绝开放首帧"
    );
  }
  const report = await input.recoverLifecycle();
  const reconciliation = await input.reconcile(input.liveAppIds());
  if (reconciliation.changed) {
    input.publish(reconciliation.affectedProjectIds);
  }
  return report;
}

export class InformationArchitectureStartup {
  private constructor(
    private readonly journal: InformationArchitectureMigrationJournal
  ) {}

  static async create(userData: string) {
    const journal = new InformationArchitectureMigrationJournal(userData);
    await journal.initialize();
    return new InformationArchitectureStartup(journal);
  }

  appFacts(apps: readonly AppRecord[]) {
    return this.journal.advance("app-facts-written", appMigrationEvidence(apps));
  }

  projects(projects: readonly StoredProject[]) {
    return this.journal.advance(
      "project-classified",
      projectMigrationEvidence(projects)
    );
  }

  bases(bases: readonly BaseEntry[]) {
    return this.journal.advance("bases-classified", baseMigrationEvidence(bases));
  }

  chats(chats: readonly ChatSummary[]) {
    return this.journal.advance("chats-migrated", chatMigrationEvidence(chats));
  }

  async complete(references: References) {
    await this.journal.advance(
      "refs-reconciled",
      referenceMigrationEvidence(references)
    );
    return this.journal.advance(
      "completed",
      completionMigrationEvidence(this.journal.snapshot().receipts)
    );
  }
}

export function classifyLegacyBaseNavigation(
  meta: BaseMeta,
  projectOf: (projectId: string) => StoredProject | undefined
): BaseNavigation {
  if (meta.owner.kind === "chat") {
    return meta.pinned
      ? {
          kind: "root-user-managed",
          source: "legacy-pin",
          activatedAt:
            meta.navigation?.kind === "root-user-managed" &&
            meta.navigation.source === "legacy-pin"
              ? meta.navigation.activatedAt
              : 0,
        }
      : { kind: "conversation-contained", chatId: meta.owner.chatId };
  }
  const project = projectOf(meta.owner.projectId);
  return project
    ? baseNavigationForProject(project, meta.navigation)
    : { kind: "project-contained", projectId: meta.owner.projectId };
}
