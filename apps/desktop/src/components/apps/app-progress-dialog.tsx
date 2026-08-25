/**
 * [INPUT]: Depends on React Locally switched, app-state deleted, shared AppOperation/AppRecord and ui dialog/button/spinner
 * [OUTPUT]: Provides AppProgressDialog, can be turned off independently, can be deleted in red, installed/updated and displayed in the latest logs
 * [POS]: The current display unit of the apps component is consumed by AppsListView; Closing only hides progress, cancelling ends the mission
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import type { AppOperation, AppRecord } from "../../../shared/apps-ipc";
import { cancelOperationLabel, isWorkingState } from "./app-state";

type AppProgressDialogProps = {
  record: AppRecord;
  step?: string;
  operation?: AppOperation;
  logPreview: string;
  onCancel: () => void;
  onShowLog: () => void;
};

export function AppProgressDialog({
  record,
  step,
  operation,
  logPreview,
  onCancel,
  onShowLog,
}: AppProgressDialogProps) {
  const [open, setOpen] = useState(true);
  const installing = record.state === "installing";
  return (
    <Dialog
      open={open && isWorkingState(record.state)}
      onOpenChange={setOpen}
    >
      <DialogContent
        className="flex max-h-[calc(100%-2rem)] flex-col gap-4 sm:max-w-2xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-8">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-700">
              <Spinner
                className="size-5"
                aria-label={installing ? "正在安装" : "正在更新"}
              />
            </span>
            <div className="min-w-0 space-y-1">
              <DialogTitle>
                {installing ? "正在安装 App" : "正在更新 App"}
              </DialogTitle>
              <DialogDescription aria-live="polite">
                {step || "正在准备任务…"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 space-y-3">
          <p className="font-medium text-xs">最新日志</p>
          <SlimScroller asChild>
            <pre className="max-h-[min(24rem,50vh)] min-h-36 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap">
              {logPreview || "等待安装日志…"}
            </pre>
          </SlimScroller>
        </div>
        <DialogFooter>
          <Button size="sm" variant="destructive" onClick={onCancel}>
            <Trash2 />
            {cancelOperationLabel[operation ?? "install"]}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
              onShowLog();
            }}
          >
            查看完整日志
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
