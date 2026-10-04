/**
 * [INPUT]: Injected storage, context keys, region validators and capability eligibility.
 * [OUTPUT]: Durable panel slots, append-only migration, invalid-slot removal and cross-window reload.
 * [POS]: Shared side-panel state owner; host identity policy never enters presentation code.
 */
export type SlotOptions<Context, Tab extends string, Region extends string> = {
  storageKey: string; format?: "rows" | "object"; storage(): Pick<Storage, "getItem" | "setItem"> | null;
  key(context: Context): string; isTab(value: unknown): value is Tab; isRegion(value: unknown): value is Region;
  eligible(context: Context, tab: Tab): boolean; independent?(context: Context, region: Region): boolean;
};
export type PanelSlotAggregate<Tab extends string = string, Region extends string = Tab> = Readonly<{
  key: string;
  revision: number;
  tabs: readonly Tab[];
  active: Region | "";
}>;

const empty = <Tab extends string, Region extends string>(key: string): PanelSlotAggregate<Tab, Region> => ({
  key,
  revision: 0,
  tabs: [],
  active: "",
});

function parseStored<Tab extends string, Region extends string>(options: SlotOptions<unknown, Tab, Region>): Map<string, PanelSlotAggregate<Tab, Region>> {
  try {
    const value = options.storage()?.getItem(options.storageKey);
    if (!value) return new Map();
    const parsed = JSON.parse(value) as unknown;
    const rows = options.format === "object" && parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.entries(parsed).map(([key, value]) => { const slot = value as Record<string, unknown> | null; return { ...slot, key, revision: slot?.revision ?? (slot?.touched ? 1 : 0), active: slot?.active ?? "" }; }) : parsed;
    if (!Array.isArray(rows)) return new Map();
    return new Map(
      rows.flatMap((row): [string, PanelSlotAggregate<Tab, Region>][] => {
        if (!row || typeof row !== "object") return [];
        const item = row as Partial<PanelSlotAggregate<Tab, Region>>;
        if (
          typeof item.key !== "string" ||
          !Number.isInteger(item.revision) ||
          !Array.isArray(item.tabs) ||
          !item.tabs.every(options.isTab) ||
          !(item.active === "" || options.isRegion(item.active))
        ) {
          return [];
        }
        return [[item.key, {
          key: item.key,
          revision: item.revision!,
          tabs: item.tabs as Tab[],
          active: item.active as Region | "",
        }]];
      })
    );
  } catch {
    return new Map();
  }
}

export class PanelSlotStore<Context, Tab extends string, Region extends string = Tab> {
  constructor(private readonly options: SlotOptions<Context, Tab, Region>) {}
  private aggregates: Map<string, PanelSlotAggregate<Tab, Region>> | null = null;
  private readonly listeners = new Set<() => void>();

  key(context: Context) {
    return this.options.key(context);
  }

  get(key: string) {
    const aggregates = this.records();
    let aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregate = empty<Tab, Region>(key);
      aggregates.set(key, aggregate);
    }
    return aggregate;
  }

  getFor(context: Context) {
    const key = this.key(context);
    const current = this.get(key);
    const tabs = current.tabs.filter(region => this.options.eligible(context, region));
    const active = current.active !== "" && this.options.independent?.(context, current.active)
      ? current.active
      : tabs.includes(current.active as Tab)
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

  migrate(from: Context, to: Context) {
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
    this.aggregates = parseStored(this.options as SlotOptions<unknown, Tab, Region>);
    for (const listener of this.listeners) listener();
  }

  replace(key: string, tabs: readonly Tab[], active: Region | "") {
    if (!tabs.every(this.options.isTab) || active !== "" && !this.options.isRegion(active)) throw new Error("INVALID_PANEL_SLOT");
    this.change(key, current => ({ ...current, tabs: [...new Set(tabs)].slice(0, 32), active }));
  }
  open(key: string, region: Tab) {
    this.change(key, (current) => ({
      ...current,
      tabs: current.tabs.includes(region)
        ? current.tabs
        : [...current.tabs, region],
      active: region as unknown as Region,
    }));
  }

  activate(key: string, region: Region | "") {
    this.change(key, (current) => ({ ...current, active: region }));
  }

  close(key: string, region: Tab) {
    this.change(key, (current) => {
      const tabs = current.tabs.filter((item) => item !== region);
      return {
        ...current,
        tabs,
        active:
          current.active === region
            ? (tabs.at(-1) as unknown as Region ?? "")
            : current.active,
      };
    });
  }

  private change(
    key: string,
    update: (current: PanelSlotAggregate<Tab, Region>) => Omit<PanelSlotAggregate<Tab, Region>, "revision">
  ) {
    const current = this.get(key);
    const next = update(current);
    this.records().set(key, { ...next, revision: current.revision + 1 });
    this.persist();
    for (const listener of this.listeners) listener();
  }

  private records() {
    this.aggregates ??= parseStored(this.options as SlotOptions<unknown, Tab, Region>);
    return this.aggregates;
  }

  private persist() {
    try {
      this.options.storage()?.setItem(
        this.options.storageKey,
        JSON.stringify(this.options.format === "object"
          ? Object.fromEntries([...this.records()].map(([key, value]) => [key, { ...value, touched: value.revision > 0, active: value.active || null }]))
          : [...this.records().values()])
      );
    } catch {
      // localStorage 配额/安全错误不应击穿面板交互；内存 aggregate 仍是本 renderer 的真相。
    }
  }
}

