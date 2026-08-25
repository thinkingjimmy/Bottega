"use client";

/**
 * [INPUT]: Depends on React, BasesProvider discardCorrupt, renderer errorMessage, i18n and ConfirmationDialog/Button
 * [OUTPUT]: Provides BaseQuarantineNotice; The only self-rescue surface belt in the isolated Base confirmed abandonment and rebuilding, and returned to the host after a successful call
 * [POS]: the separation of components/bases; The CAS/View sorting is not related to Workbench, so keep busy/error/confirm the three-mode non-reversible combination root
 */

import { useState } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useBases } from "@/components/providers/bases-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";

export function BaseQuarantineNotice({
  ownerKey,
  onDiscarded,
}: {
  ownerKey: string;
  onDiscarded(): void;
}) {
  const { t } = useAppTranslation();
  const bases = useBases();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <p className="font-medium text-destructive text-sm">
          {t("bases.quarantined")}
        </p>
        <p className="text-muted-foreground text-xs">
          {t("bases.quarantinedDescription")}
        </p>
        <Button
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          type="button"
          variant="destructive"
        >
          {t("bases.discardData")}
        </Button>
        <ConfirmationDialog
          busy={busy}
          confirmLabel={t("bases.discardAndRecreate")}
          confirmTone="destructive"
          description={t("bases.discardDescription")}
          onConfirm={() => {
            setBusy(true);
            setError("");
            void bases
              .discardCorrupt(ownerKey)
              .then(() => {
                setConfirmOpen(false);
                onDiscarded();
              })
              .catch((cause) => setError(errorMessage(cause)))
              .finally(() => setBusy(false));
          }}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
          title={t("bases.discardTitle")}
        />
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    </div>
  );
}
