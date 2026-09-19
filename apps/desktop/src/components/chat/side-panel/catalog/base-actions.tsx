/**
 * [INPUT]: Depends on host Base actions and the deferred App-save entry.
 * [OUTPUT]: Provides Base tab menu actions only for a mounted Base panel.
 * [POS]: On-demand side-panel catalog action boundary.
 */
import { SaveAsAppDialog } from "@/components/apps/dialogs/save-as-app";
import {
useBaseAppActions
} from "@/components/bases/chrome/base-header-actions";
import { baseTabActionButtonClass } from "@ai-chat/base-ui/ui/chrome/base-tab-chrome";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
DownloadIcon,
ExternalLinkIcon,
MoreHorizontal,
PackagePlusIcon
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

/** Base tab 的 App/CSV 菜单：随 Base tab 生灭，不存在时不订阅 Base 状态 */
export default function BaseTabMenu({
  ownerKey,
  chatId,
}: {
  ownerKey: string;
  chatId: string;
}) {
  const { t } = useAppTranslation();
  const {
    app,
    busy,
    defaultName,
    ready,
    saveChatId,
    exportCsv,
  } = useBaseAppActions(ownerKey, chatId);
  const [saveOpen, setSaveOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t("chat.sidePanel.moreBaseActions")}
            className={baseTabActionButtonClass}
            onClick={(event) => event.stopPropagation()}
            title={t("chat.sidePanel.more")}
            type="button"
          >
            <MoreHorizontal className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          {app ? (
            <DropdownMenuItem asChild>
              <Link to={`/apps/${app.id}`}>
                <ExternalLinkIcon />
                {t("chat.sidePanel.openApp")}
              </Link>
            </DropdownMenuItem>
          ) : saveChatId ? (
            <DropdownMenuItem
              disabled={busy || !ready}
              onSelect={() => setSaveOpen(true)}
            >
              <PackagePlusIcon />
              {t("chat.sidePanel.saveAsApp")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={busy || !ready}
            onSelect={() => void exportCsv()}
          >
            <DownloadIcon />
            {t("chat.sidePanel.downloadCsv")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {saveChatId && (
        <SaveAsAppDialog
          chatId={saveChatId}
          defaultName={defaultName}
          onOpenChange={setSaveOpen}
          open={saveOpen}
        />
      )}
    </>
  );
}
