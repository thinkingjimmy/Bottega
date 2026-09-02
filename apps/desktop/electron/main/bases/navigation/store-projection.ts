/**
 * [INPUT]: Depends on canonical Base navigation facts, stored Base states, and shared sidebar summary projections
 * [OUTPUT]: Provides root/project Base lists, compact owner summaries, and canonical navigation mutations
 * [POS]: Bases navigation policy module; BaseStore delegates pure visibility projection and metadata mutation here
 */

import {
  baseNavigationOf,
  ownerKeyOf,
  type BaseSnapshot,
  type BasePinnedSummary,
} from "../../../../shared/bases-ipc";
import {
  appearsInProjectBase,
  appearsInRootBases,
} from "../../../../shared/placement/base";
import type { BaseNavigation } from "../../../../shared/placement/facts";
import {
  baseNavigationSummary,
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
): BasePinnedSummary[] {
  return [...states]
    .filter(({ meta }) => appearsInRootBases(baseNavigationOf(meta)))
    .sort(
      (left, right) =>
        left.meta.name.localeCompare(right.meta.name) ||
        ownerKeyOf(left.meta.owner).localeCompare(ownerKeyOf(right.meta.owner))
    )
    .map(({ meta }) => baseNavigationSummary(meta));
}

export function projectBaseSummaries(
  states: Iterable<StoredBase>
): BasePinnedSummary[] {
  return [...states]
    .filter(({ meta }) => {
      const navigation = baseNavigationOf(meta);
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
      pinned: navigation.kind === "root-user-managed",
      revision: current.meta.revision + 1,
    },
    rows: current.rows,
    rowsChanged: false,
    actor: "system",
    operation: "navigation-change",
  };
}
