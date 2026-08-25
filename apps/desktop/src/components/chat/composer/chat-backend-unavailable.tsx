/**
 * [INPUT]: Depends on i18n, shared BackendInfo, Agent icon/name and ui/button
 * [OUTPUT]: Provides ChatBackendUnavailable to replace the non-recovered history chat input area with read-only tip bars
 * [POS]: The back of the composer fails to border; No editable, permissible or model controls
 */

import { RefreshCwIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type {
  AgentBackendId,
  BackendInfo,
} from "../../../../shared/agent-ipc";
import {
  AgentBackendIcon,
  backendGuideKey,
  backendLabel,
} from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function ChatBackendUnavailable({
  backend,
  info,
  onConfigure,
  onRetry,
}: {
  backend: AgentBackendId;
  info?: BackendInfo;
  onConfigure: () => void;
  onRetry: () => Promise<void>;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="rounded-2xl border bg-muted/40 p-4">
      <div className="flex items-start gap-3">
        <AgentBackendIcon
          backend={backend}
          className="mt-0.5 size-5 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">
            {t("chat.readOnly")}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {t("chat.backendUnavailable", { backend: backendLabel(backend) })}
            {info ? t(backendGuideKey(info)) : t("chat.backendRetryHint")}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={onConfigure}>
              {t("chat.installOrSignIn")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void onRetry()}>
              <RefreshCwIcon />
              {t("chat.checkAgain")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
