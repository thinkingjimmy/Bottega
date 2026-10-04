/**
 * [INPUT]: Depends on the current App, its Base owner, the regular Base workbench and approved enablement control.
 * [OUTPUT]: Provides AppClosedView: reopen from a direct link, while retained Base data remains editable.
 * [POS]: Disabled App route; mounts no App GUI, Use panel or Editor surface.
 */
import { appDisplayName, type AppRecord } from "../../../../shared/ipc/apps/apps-ipc";
import { Button } from "@ai-chat/ui/components/ui/button";
import { BaseWorkbench } from "@/components/bases/base-workbench";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useAppBase } from "../surface/use-app-base";
import { useAppEnablement } from "./control";
export function AppClosedView({ record }: { record: AppRecord }) {
  const { i18n } = useAppTranslation(), control = useAppEnablement(record, i18n.language), base = useAppBase(record);
  return <div className="flex h-full min-h-0 flex-col" data-app-closed={record.id}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h1 className="text-base font-medium">{appDisplayName(record)}</h1>
      <p className="text-sm text-muted-foreground">{control.copy.closedBody}</p></div>
      <Button disabled={control.busy} onClick={control.toggle}>{control.copy.open}</Button></div>
    {control.error && <p role="alert" className="p-4 text-sm text-destructive">{control.error}</p>}
    {record.manifest?.kind === "base" && base.ownerKey && <BaseWorkbench ownerKey={base.ownerKey} />}{control.dialog}
  </div>;
}
