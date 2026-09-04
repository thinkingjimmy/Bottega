/**
 * [INPUT]: Depends on AppStore, Base App directory skeleton and create-skill turn requestId
 * [OUTPUT]: Provides complete BaseAppSkill/failBaseAppSkill/hasGeneratedSkill, and is judged by the same AGENTS.md+SKILL.md settlement skills status
 * [POS]: The ability of the apps module to complete the truth source; Agent finalizer is used in conjunction with the Restore startup, without each guessing the product
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AppRecord } from "../../../../shared/apps-ipc";
import type { AppStore } from "../store/app-store";
import { APP_SKILL_PLACEHOLDER } from "./templates";

type SkillStatusDependencies = {
  store: AppStore;
  invalidate?(): void;
};

export async function completeBaseAppSkill(
  appId: string,
  requestId: string,
  dependencies: SkillStatusDependencies
) {
  const record = matchingPendingRecord(
    dependencies.store.get(appId),
    requestId
  );
  if (!record) return;
  const state = (await hasGeneratedSkill(record)) ? "done" : "failed";
  await updateState(record.id, state, dependencies);
  dependencies.invalidate?.();
}

export async function failBaseAppSkill(
  appId: string,
  requestId: string,
  dependencies: SkillStatusDependencies
) {
  const record = matchingPendingRecord(
    dependencies.store.get(appId),
    requestId
  );
  if (record) await updateState(record.id, "failed", dependencies);
}

function matchingPendingRecord(
  record: AppRecord | undefined,
  requestId: string
) {
  if (
    record?.manifest?.kind !== "base" ||
    record.skillStatus?.state !== "pending" ||
    requestId !== `${record.skillStatus.turnIntentId}-request`
  ) {
    return null;
  }
  return record;
}

export async function hasGeneratedSkill(record: AppRecord) {
  const agents = await readFile(join(record.dir, "AGENTS.md"), "utf8").catch(
    () => ""
  );
  const entries = await readdir(join(record.dir, ".agents", "skills"), {
    withFileTypes: true,
  }).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        stat(join(record.dir, ".agents", "skills", entry.name, "SKILL.md"))
          .then((value) => value.isFile())
          .catch(() => false)
      )
  );
  return Boolean(
    agents &&
      !agents.includes(APP_SKILL_PLACEHOLDER) &&
      files.includes(true)
  );
}

async function updateState(
  appId: string,
  state: "done" | "failed",
  dependencies: SkillStatusDependencies
) {
  await dependencies.store.update(appId, (record) => ({
    ...record,
    skillStatus: record.skillStatus
      ? { ...record.skillStatus, state }
      : null,
  }));
}
