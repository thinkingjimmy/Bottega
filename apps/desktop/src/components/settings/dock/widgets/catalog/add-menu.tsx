/**
 * [INPUT]: Shared DropdownMenu/Button primitives, existing Add/New commands and localized Widget labels.
 * [OUTPUT]: WidgetAddMenu with Browse Widgets when available, Add existing Widget and New Widget.
 * [POS]: Catalog acquisition entry; choosing a menu item delegates to existing confirmation or authoring owners.
 */
import { ChevronDown, Download, LayoutGrid, Plus, SquarePen } from 'lucide-react';
import { Button } from '@ai-chat/ui/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@ai-chat/ui/components/ui/dropdown-menu';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
export function WidgetAddMenu({ busy, onAdd, onNew, onBrowse }: { busy: boolean; onAdd(): void; onNew(): void; onBrowse?(): void }) {
  const { t } = useAppTranslation();
  return <DropdownMenu><DropdownMenuTrigger asChild><Button data-widget-add="" variant="ghost" size="sm" disabled={busy} className="gap-1.5" aria-label={t('systemDock.widgets.add')}>
    <Plus />{t('systemDock.widgets.add')}<ChevronDown className="size-3.5" />
  </Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-max min-w-48">
    {onBrowse&&<DropdownMenuItem onSelect={onBrowse}><Download />{t("systemDock.widgets.directory.title")}</DropdownMenuItem>}
    <DropdownMenuItem onSelect={onAdd}><LayoutGrid />{t('systemDock.widgets.addExisting')}</DropdownMenuItem>
    <DropdownMenuItem onSelect={onNew}><SquarePen />{t('systemDock.widgets.new')}</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}
