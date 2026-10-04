/**
 * [INPUT]: Depends on dnd-kit core/sortable, the renderer settings store, the Setup context, Settings navigation, ProviderRow and Providers i18n
 * [OUTPUT]: Provides ProviderList — the drag-to-reorder list of every Provider catalog entry (saved order first, the rest after; every row is reordered and saved) with an optimistic order, localized screen-reader announcements and the explicit default Agent
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
import { ProviderRow, type ProviderFix } from "./provider-row";

export function ProviderList() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const navigation = useSettingsNavigation();
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  /* The drop must land where the finger let go; waiting for the settings round trip would snap the row back for a frame. */
  const [pending, setPending] = useState<readonly string[] | null>(null);
  const catalog = useProviderCatalog();
  const entries = orderedProviders(settings, catalog);
  const order = pending ?? entries.map((entry) => entry.id);
  const defaultBackend = settings?.defaultBackend ?? order.find(isAgentBackendId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const failure = t("settings.providers.saveFailed");
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
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove([...order], order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setPending(next);
    /* Main keeps every Provider id in the order (S3-c), a package or gone one included. */
    void settingsStore.update({ providerOrder: next }, failure, { errorScope: "local" }).finally(() => setPending(null));
  };
  const fix = (value: ProviderFix) => value === "update" ? navigation?.openUpdates() : setup.openOnboarding("agent");
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
    <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
      <SettingsList>
        {order.flatMap((id) => {
          const entry = entries.find((candidate) => candidate.id === id);
          return entry ? [<ProviderRow key={id} entry={entry} now={setup.now} isDefault={id === defaultBackend}
            backend={setup.status?.backends.find((info) => info.id === id)} onFix={fix}
            onMakeDefault={(backend) => void settingsStore.update({ defaultBackend: backend }, failure, { errorScope: "local" })} />] : [];
        })}
      </SettingsList>
    </SortableContext>
  </DndContext>;
}
