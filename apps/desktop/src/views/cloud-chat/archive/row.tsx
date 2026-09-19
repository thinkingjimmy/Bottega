/**
 * [INPUT]: Shared ArchiveRow presentation, mirrored identity, stable Chat routes and lazy durable facts controls.
 * [OUTPUT]: Renders an archived mirror with reading and explicit metadata management.
 * [POS]: Mirror archive surface; local selection, purge and execution capabilities are never synthesized.
 */
import { lazy, Suspense, useState } from "react";
import { Link } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { intlLocale } from "@/lib/i18n-locale";
import {
  ArchiveRow,
  archiveRowId,
  formatArchivedAt,
} from "@ai-chat/ui/components/archive/row";
import type { MirrorArchiveItem } from "./items";
const Facts = lazy(() =>
  import("../facts").then((module) => ({ default: module.DesktopFactsEntry })),
);
export function MirrorArchiveRow({
  item,
  targeted,
}: {
  item: MirrorArchiveItem;
  targeted: boolean;
}) {
  const { t } = useAppTranslation(),
    [open, setOpen] = useState(false),
    title = item.title ?? t("common.chats");
  return (
    <>
      <ArchiveRow
        id={archiveRowId(item.key)}
        targeted={targeted}
        data-cloud-archive={item.head.chat.id}
        title={title}
        iconLabel={t("archive.chatKind")}
        icon={
          <AgentBackendIcon backend={item.head.chat.agent} className="size-4" />
        }
        primaryAction={
          <Link to={`/chat/${encodeURIComponent(item.head.chat.id)}`} />
        }
        date={formatArchivedAt(item.archivedAt, intlLocale())}
        actions={
          <Button
            size="icon"
            variant="ghost"
            className="size-11 shrink-0"
            aria-label={t("projects.moreActions", { name: title })}
            onClick={() => setOpen(true)}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {open && (
            <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
              <Facts chatId={item.head.chat.id} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
