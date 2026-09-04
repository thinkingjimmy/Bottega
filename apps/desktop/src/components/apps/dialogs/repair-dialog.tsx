/**
 * [INPUT]: Depends on Apps i18n and UI dialog/button primitives
 * [OUTPUT]: Provides RepairConfirmDialog, maintains Agent Red Line security confirmation for repairs
 * [POS]: Sole Apps repair-risk confirmation shared by cards and detail surfaces
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
import { useAppTranslation } from "@/components/providers/i18n-provider";

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
  const { t } = useAppTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("apps.repair.title")}</DialogTitle>
          <DialogDescription>
            {t("apps.repair.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {t("apps.repair.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
