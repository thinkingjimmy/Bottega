/**
 * [INPUT]: Depends on canonical Base navigation facts, stored Base states, and shared sidebar summary projections
 * [OUTPUT]: Provides root/project Base lists, compact owner summaries, and canonical navigation mutations that declare zero touched rows
 * [POS]: Bases navigation policy module; BaseStore delegates pure visibility projection and metadata mutation here
 */

import {
  ownerKeyOf,
  type BaseSnapshot,
  type BaseNavigationSummary,
} from "../../../../shared/bases-ipc";
import {
  appearsInProjectBase,
  appearsInRootBases,
} from "../../../../shared/placement/base";
import type { BaseNavigation } from "../../../../shared/placement/facts";
import {
  baseNavigationSummary,
  NO_ROWS_CHANGED,
  type BaseStoreMutation,
  type StoredBase,
} from "../base-store-model";

const clone = <T>(value: T): T => structuredClone(value);

export function baseOwnerSummaries(states: ReadonlyMap<string, StoredBase>) {
  return new Map(
    [...states.entries()].map(([ownerKey, { meta, rows }]) => [
      ownerKey,
      {
        owner: clone(meta.owner),
        ownerInstanceId: meta.ownerInstanceId,
        rowCount: rows.length,
      },
    ])
  );
}

export function rootBaseSummaries(
  states: Iterable<StoredBase>
): BaseNavigationSummary[] {
  return [...states]
    .filter(({ meta }) => appearsInRootBases(meta.navigation))
    .sort(
      (left, right) =>
        left.meta.name.localeCompare(right.meta.name) ||
        ownerKeyOf(left.meta.owner).localeCompare(ownerKeyOf(right.meta.owner))
    )
    .map(({ meta }) => baseNavigationSummary(meta));
}

export function projectBaseSummaries(
  states: Iterable<StoredBase>
): BaseNavigationSummary[] {
  return [...states]
    .filter(({ meta }) => {
      const navigation = meta.navigation;
      return (
        navigation.kind === "project-contained" &&
        appearsInProjectBase(navigation, navigation.projectId)
      );
    })
    .sort((left, right) => left.meta.name.localeCompare(right.meta.name))
    .map(({ meta }) => baseNavigationSummary(meta));
}

export function navigationMutation(
  current: BaseSnapshot,
  navigation: BaseNavigation
): BaseStoreMutation | null {
  if (JSON.stringify(current.meta.navigation) === JSON.stringify(navigation)) {
    return null;
  }
  return {
    meta: {
      ...current.meta,
      navigation,
      revision: current.meta.revision + 1,
    },
    /* 导航改的是 meta：rows 原样交回，引用相等即「这次没碰行」的证明。 */
    rows: current.rows,
    changedRowIds: NO_ROWS_CHANGED,
    actor: "system",
    operation: "navigation-change",
  };
}
