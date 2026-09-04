/**
 * [INPUT]: Depends on AppStore durable generations, the shared support-matrix verdict, and the GUI runtime revocation boundary
 * [OUTPUT]: Provides candidate-update preflight that blocks unsupported contracts or durably quarantines security-revoked Apps before installation
 * [POS]: Apps lifecycle release guard; updater policy stays pure while this adapter owns local durable consequences
 */

import type { AppGuiCompatibilitySupport } from "../../../../../shared/app-gui/support";
import { evaluateAppGuiCompatibility } from "../../../../../shared/app-gui/support";
import type { AppStore } from "../../store/app-store";

type RuntimePort = Readonly<{
  quarantine(appId: string): Promise<void>;
}>;

export async function applyCandidateCompatibility(
  store: AppStore,
  runtime: RuntimePort,
  matrix: AppGuiCompatibilitySupport
) {
  const records = store.list();
  const generations = records.flatMap((record) => record.generations.map(
    (generation) => ({ record, generation })
  ));
  const missing = generations.filter(({ generation }) =>
    generation.manifest.kind === "base" &&
    Boolean(generation.manifest.gui) &&
    !generation.compatibilityRef
  );
  if (missing.length) {
    throw compatibilityError(
      "GUI_COMPATIBILITY_UNSUPPORTED",
      `Missing durable compatibility refs: ${missing.map(({ generation }) => generation.generationId).join(", ")}`
    );
  }
  const refs = generations.flatMap(({ generation }) =>
    generation.compatibilityRef ? [generation.compatibilityRef] : []
  );
  const verdict = evaluateAppGuiCompatibility(refs, matrix);
  if (verdict.status === "blocked") {
    throw compatibilityError(
      "GUI_COMPATIBILITY_UNSUPPORTED",
      `Unsupported contracts: ${verdict.unsupported.join(", ")}`
    );
  }
  if (verdict.status !== "quarantine") return;

  const affected = records.filter((record) => record.generations.some((generation) =>
    generation.compatibilityRef &&
    evaluateAppGuiCompatibility([generation.compatibilityRef], matrix).status === "quarantine"
  ));
  for (const record of affected) {
    await runtime.quarantine(record.id);
    await store.update(record.id, (current) => ({
      ...current,
      state: "quarantined",
      lastError: {
        phase: "update",
        message: `安全更新已隔离被撤销的 App GUI 合同：${verdict.revoked.join(", ")}`,
      },
      lifecycleRevision: current.lifecycleRevision + 1,
      manifest: null,
      generationBinding: {
        ...current.generationBinding,
        bindingRevision: current.generationBinding.bindingRevision + 1,
        active: null,
        pending: undefined,
      },
    }));
  }
}

function compatibilityError(code: string, message: string) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
