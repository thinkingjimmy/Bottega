/**
 * [INPUT]: Depends on the injected lifecycle reconciliation, App authority state, live App id set, and Project placement reconciler
 * [OUTPUT]: Provides the required lifecycle→App authority→Project placement first-snapshot gate
 * [POS]: Startup ordering seam; keeps first-frame placement arbitration out of the Electron process root
 */

type PlacementReconciliation = Readonly<{
  changed: boolean;
  affectedProjectIds: readonly string[];
}>;

/* App 权威降级时首帧必须关着：此刻 live App 集合是残缺的，任何"孤儿
   placement"判定都会把仍然有效的绑定当成垃圾清掉。 */
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
