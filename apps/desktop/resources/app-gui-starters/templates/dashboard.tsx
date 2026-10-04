/**
 * [INPUT]: Depends on typed Base aggregate query, Bottega Chart, date-fns, and standard UI Blocks
 * [OUTPUT]: Provides the Dashboard official Starter entry
 * [POS]: Production authoring template for bounded aggregate visualization
 */

import { format, subDays } from "date-fns";
import { useBaseRows } from "@bottega/app-react";
import { DataPage, EmptyState, ErrorState, LoadingState, PermissionState } from "@bottega/app-blocks";
import { Chart } from "@bottega/charts";
type Group = { groupId: string; keys: unknown[]; rowCount: number; aggregates: Record<string, number | null> };

export default function DashboardStarter() {
  const result = useBaseRows<{ groups: Group[] }>({
    shape: { version: 1, mode: "groups", groupBy: ["status"], aggregates: [{ id: "total", columnId: "amount", op: "sum" }] },
    page: { limit: 50 },
  });
  if (result.status === "loading") return <DataPage title="Dashboard"><LoadingState /></DataPage>;
  if (result.status === "error") return <DataPage title="Dashboard">{result.error.code === "permission_denied" ? <PermissionState /> : <ErrorState action={<button className="min-h-11 rounded-md border px-4" onClick={result.retry}>Retry</button>} />}</DataPage>;
  if (!result.data.groups.length) return <DataPage title="Dashboard"><EmptyState description="Add rows before charting aggregates." /></DataPage>;
  const end = new Date();
  return <DataPage title="Dashboard" description={format(subDays(end, 30), "yyyy-MM-dd") + " — " + format(end, "yyyy-MM-dd")}><Chart ariaLabel="Totals by status" option={{ xAxis: { type: "category", data: result.data.groups.map((group) => String(group.keys[0] ?? "Empty")) }, yAxis: { type: "value" }, series: [{ type: "bar", data: result.data.groups.map((group) => group.aggregates.total ?? 0) }] }} /></DataPage>;
}
