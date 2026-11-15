/**
 * [INPUT]: Shared DropdownMenu/Button primitives, the existing Browse and New commands and localized Widget store labels.
 * [OUTPUT]: WidgetAddMenu with Browse official Widgets when available and Build with your Agent; listed Widgets are added from the page itself.
 * [POS]: Catalog acquisition entry; choosing a menu item delegates to the existing directory or authoring owners.
 */
import { ChevronDown, Download, Plus, Sparkles } from 'lucide-react';
import { Button } from '@ai-chat/ui/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@ai-chat/ui/components/ui/dropdown-menu';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
export function WidgetAddMenu({ busy, onNew, onBrowse }: { busy: boolean; onNew(): void; onBrowse?(): void }) {
  const { t } = useAppTranslation();
  const item = (label: string, hint: string) => <span><span className="block font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button data-widget-add="" variant="outline" size="lg" disabled={busy} className="gap-1.5 px-3 text-sm" aria-label={t('systemDock.widgets.add')}>
    <Plus />{t('systemDock.widgets.add')}<ChevronDown className="size-3.5 opacity-60" />
  </Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-max min-w-64">
    {onBrowse&&<DropdownMenuItem onSelect={onBrowse} className="items-start py-2"><Download className="mt-0.5" />{item(t('systemDock.widgets.directory.title'), t('systemDock.widgets.store.browseHint'))}</DropdownMenuItem>}
    <DropdownMenuItem onSelect={onNew} className="items-start py-2"><Sparkles className="mt-0.5" />{item(t('systemDock.widgets.store.build'), t('systemDock.widgets.store.buildHint'))}</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}
