/**
 * [INPUT]: Depends on React useSyncExternalStore, panel-catalog static/App/Image region verification and renderer localStorage; The key conversation is made up of ID+incarnationId
 * [OUTPUT]: Provides durable PanelSlotAggregate, panelSlotStore and usePanelSlots; Open to load with id and not hold any media load
 * [POS]: The only owner of the per-incarnation slot of the chat/side-panel; Reload / renderer reload Restored, Incarnation Reloaded Natural Get Empty Aggregate
 */

import { useSyncExternalStore } from "react";
import {
  isImageRegion,
  type PanelRegion,
  type PanelTabId,
} from "./panel-catalog";

export type PanelSlotAggregate = Readonly<{
  key: string;
  revision: number;
  tabs: readonly PanelTabId[];
  active: PanelRegion | "";
}>;

const empty = (key: string): PanelSlotAggregate => ({
  key,
  revision: 0,
  tabs: [],
  active: "",
});

const STORAGE_KEY = "ai-chat:panel-slots:v1";

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isPanelTabId = (value: unknown): value is PanelTabId =>
  value === "base" ||
  value === "subagents" ||
  (typeof value === "string" &&
    (value.startsWith("app:") || isImageRegion(value)));

const isPanelRegion = (value: unknown): value is PanelRegion | "" =>
  value === "" || value === "browser" || isPanelTabId(value);

function parseStored(): Map<string, PanelSlotAggregate> {
  const value = storage()?.getItem(STORAGE_KEY);
  if (!value) return new Map();
  try {
    const rows = JSON.parse(value) as unknown;
    if (!Array.isArray(rows)) return new Map();
    return new Map(
      rows.flatMap((row): [string, PanelSlotAggregate][] => {
        if (!row || typeof row !== "object") return [];
        const item = row as Partial<PanelSlotAggregate>;
        if (
          typeof item.key !== "string" ||
          !Number.isInteger(item.revision) ||
          !Array.isArray(item.tabs) ||
          !item.tabs.every(isPanelTabId) ||
          !isPanelRegion(item.active)
        ) {
          return [];
        }
        return [[item.key, {
          key: item.key,
          revision: item.revision!,
          tabs: item.tabs as PanelTabId[],
          active: item.active as PanelRegion | "",
        }]];
      })
    );
  } catch {
    return new Map();
  }
}

export class PanelSlotStore {
  private aggregates: Map<string, PanelSlotAggregate> | null = null;
  private readonly listeners = new Set<() => void>();

  key(conversationId: string, incarnationId: string) {
    return `${conversationId}\u0000${incarnationId}`;
  }

  get(key: string) {
    const aggregates = this.records();
    let aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregate = empty(key);
      aggregates.set(key, aggregate);
    }
    return aggregate;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  open(key: string, region: PanelTabId) {
    this.change(key, (current) => ({
      ...current,
      tabs: current.tabs.includes(region)
        ? current.tabs
        : [...current.tabs, region],
      active: region,
    }));
  }

  activate(key: string, region: PanelRegion | "") {
    this.change(key, (current) => ({ ...current, active: region }));
  }

  close(key: string, region: PanelTabId) {
    this.change(key, (current) => {
      const tabs = current.tabs.filter((item) => item !== region);
      return {
        ...current,
        tabs,
        active:
          current.active === region
            ? (tabs.at(-1) ?? "")
            : current.active,
      };
    });
  }

  private change(
    key: string,
    update: (current: PanelSlotAggregate) => Omit<PanelSlotAggregate, "revision">
  ) {
    const current = this.get(key);
    const next = update(current);
    this.records().set(key, { ...next, revision: current.revision + 1 });
    this.persist();
    for (const listener of this.listeners) listener();
  }

  private records() {
    this.aggregates ??= parseStored();
    return this.aggregates;
  }

  private persist() {
    try {
      storage()?.setItem(
        STORAGE_KEY,
        JSON.stringify([...this.records().values()])
      );
    } catch {
      // localStorage 配额/安全错误不应击穿面板交互；内存 aggregate 仍是本 renderer 的真相。
    }
  }
}

export const panelSlotStore = new PanelSlotStore();

export function usePanelSlots(key: string) {
  return useSyncExternalStore(
    panelSlotStore.subscribe,
    () => panelSlotStore.get(key),
    () => panelSlotStore.get(key)
  );
}
