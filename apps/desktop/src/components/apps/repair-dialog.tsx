/**
 * [INPUT]: Depends on ui dialog/button
 * [OUTPUT]: Provides RepairConfirmDialog, maintains Agent Red Line security confirmation for repairs
 * [POS]: Repair of apps component confirms the only source, the card shares the same warning document with the details page
 */

import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";

type RepairConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onConfirm: () => void;
};

export function RepairConfirmDialog({
  open,
  onOpenChange,
  busy = false,
  onConfirm,
}: RepairConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>让维护 Agent 诊断修复？</DialogTitle>
          <DialogDescription>
            维护 Agent 将在该 App 的隔离副本中联网执行修复操作。修复会话同时持有对应
            Agent 的登录凭证、网络访问与该仓库代码的执行能力，修复期间执行的仓库命令
            与首次安装一样以你的用户权限运行——仓库中的恶意内容有可能诱导修复过程
            执行非预期操作。仅对你信任的仓库使用。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            开始修复
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
