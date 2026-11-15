/**
 * [INPUT]: Depends on dnd-kit core/sortable, the renderer settings store, the Setup context, Settings navigation, ProviderRow and Providers i18n
 * [OUTPUT]: Provides ProviderList — the drag-to-reorder list of every Provider catalog entry (saved order first, the rest after; every row is reordered and saved) with an optimistic order, localized screen-reader announcements, the default radio and the row save-failure error (S16, S20 r3)
 * [POS]: Body of Settings › Providers; the saved order is what every Agent picker renders, the default is where new Chats start
 */

import { useState, useSyncExternalStore } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useSettingsNavigation } from "@/components/providers/navigation/context";
import { useSetup } from "@/components/providers/setup-provider";
import { SettingsList } from "@/components/settings/settings-layout";
import { isAgentBackendId, orderedProviders, providerName } from "@/lib/agent/agent-backends";
import { useProviderCatalog } from "@/lib/provider-catalog/hooks";
import { settingsStore } from "@/lib/settings/store/settings-store";
import { ProviderRow, type ProviderFix, type ProviderRowError } from "./provider-row";

export function ProviderList() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const navigation = useSettingsNavigation();
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  /* The drop must land where the finger let go; waiting for the settings round trip would snap the row back for a frame. */
  const [pending, setPending] = useState<readonly string[] | null>(null);
  /* The save failure surfaces on the row it belongs to (S20 r3): no toast, a Retry re-runs the same write. */
  const [saveError, setSaveError] = useState<(ProviderRowError & { id: string }) | null>(null);
  const catalog = useProviderCatalog();
  const entries = orderedProviders(settings, catalog);
  const order = pending ?? entries.map((entry) => entry.id);
  const defaultBackend = settings?.defaultBackend ?? order.find(isAgentBackendId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const nameOf = (id: string | number) => {
    const entry = entries.find((candidate) => candidate.id === String(id));
    return entry ? providerName(entry) : String(id);
  };
  const position = (id: string | number | undefined) => ({ position: order.indexOf(String(id)) + 1, total: order.length });
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("settings.providers.picked", { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) => over ? t("settings.providers.moved", { name: nameOf(active.id), ...position(over.id) }) : undefined,
    onDragEnd: ({ active, over }) => over ? t("settings.providers.moved", { name: nameOf(active.id), ...position(over.id) }) : undefined,
    onDragCancel: () => t("settings.providers.cancelled"),
  };
  const saveOrder = async (id: string, next: readonly string[]) => {
    const ok = await settingsStore.update({ providerOrder: [...next] }, "", { errorScope: "local" });
    if (ok) setSaveError(null);
    else setSaveError({ id, message: t("settings.providers.saveFailedOrder"), onRetry: () => void saveOrder(id, next) });
    return ok;
  };
  const saveDefault = async (id: string) => {
    const ok = await settingsStore.update({ defaultBackend: id }, "", { errorScope: "local" });
    if (ok) setSaveError(null);
    else setSaveError({
      id,
      /* The store rejects the write, so the previous value still stands — the row's description names it. */
      message: t("settings.providers.saveFailedDefault", { name: nameOf(defaultBackend ?? "") }),
      onRetry: () => void saveDefault(id),
    });
    return ok;
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove([...order], order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setPending(next);
    /* Main keeps every Provider id in the order (S3-c), a package or gone one included. */
    void saveOrder(String(active.id), next).finally(() => setPending(null));
  };
  const fix = (value: ProviderFix) => value === "update" ? navigation?.openUpdates() : setup.openOnboarding("agent");
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
    <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
      {/* S16: the list is one radiogroup — each row's leading radio is the Default control. */}
      <SettingsList role="radiogroup" aria-label={t("settings.providers.default")}>
        {order.flatMap((id) => {
          const entry = entries.find((candidate) => candidate.id === id);
          return entry ? [<ProviderRow key={id} entry={entry} now={setup.now} isDefault={id === defaultBackend}
            backend={setup.status?.backends.find((info) => info.id === id)} onFix={fix}
            error={saveError?.id === id ? saveError : undefined}
            onMakeDefault={(backend) => void saveDefault(backend)} />] : [];
        })}
      </SettingsList>
    </SortableContext>
  </DndContext>;
}
