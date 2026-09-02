/**
 * [INPUT]: Depends on React useSyncExternalStore, PanelSessionContext eligibility, panel-catalog region verification and renderer localStorage
 * [OUTPUT]: Provides durable PanelSlotAggregate, context-derived keys, explicit cross-window storage reload, ineligible-slot sanitization, append-only migration and usePanelSlots
 * [POS]: The only owner of the per-generation slot of chat/side-panel; a slot the current context is not eligible for never survives a restore
 */

import { useSyncExternalStore } from "react";
import {
  isAppRegion,
  isImageRegion,
  type PanelRegion,
  type PanelTabId,
} from "./panel-catalog";
import {
  panelConversationKey,
  panelGenerationKey,
  panelEligibility,
  type PanelSessionContext,
} from "../runtime/chat-session-model";

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

  key(context: PanelSessionContext) {
    return `${panelConversationKey(context)}\u0000${panelGenerationKey(context)}`;
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

  getFor(context: PanelSessionContext) {
    const key = this.key(context);
    const current = this.get(key);
    const tabs = current.tabs.filter((region) => {
      const capability = isImageRegion(region)
        ? "image"
        : isAppRegion(region)
          ? "app"
          : region;
      return panelEligibility(context, capability).allowed;
    });
    const active = current.active === "browser"
      ? current.active
      : tabs.includes(current.active as PanelTabId)
        ? current.active
        : "";
    if (tabs.length === current.tabs.length && active === current.active) {
      return current;
    }
    const next = { ...current, tabs, active, revision: current.revision + 1 };
    this.records().set(key, next);
    this.persist();
    return next;
  }

  migrate(from: PanelSessionContext, to: PanelSessionContext) {
    const source = this.getFor(from);
    const targetKey = this.key(to);
    const target = this.getFor(to);
    const tabs = [...target.tabs];
    for (const tab of source.tabs) {
      if (!tabs.includes(tab)) tabs.push(tab);
    }
    const active = source.active || target.active;
    this.records().set(targetKey, {
      key: targetKey,
      revision: target.revision + 1,
      tabs,
      active,
    });
    this.persist();
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Same-origin windows share bytes, not module memory; migration must refresh the live cache explicitly. */
  reloadFromStorage() {
    this.aggregates = parseStored();
    for (const listener of this.listeners) listener();
  }

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

export function usePanelSlots(context: PanelSessionContext) {
  return useSyncExternalStore(
    panelSlotStore.subscribe,
    () => panelSlotStore.getFor(context),
    () => panelSlotStore.getFor(context)
  );
}
