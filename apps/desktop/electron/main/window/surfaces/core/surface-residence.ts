/**
 * [INPUT]: Depends on the shared strict surface-key grammar
 * [OUTPUT]: Provides SurfaceResidenceLedger with main-sentinel storage, revision CAS, compound moves, and window reclamation
 * [POS]: Window surfaces core single writer for one-surface-one-window truth; migration coordinates through this ledger instead of renderer state
 */

import {
  assertSurfaceKey,
  type SurfaceKey,
  type SurfaceResidence,
} from "../../../../../shared/window-surfaces-ipc";

type StoredClaim = Readonly<{ windowId: string; claimRevision: number }>;
type Move = Readonly<{
  surface: SurfaceKey;
  expectedRevision: number;
  windowId: string | null;
}>;

export class SurfaceResidenceConflict extends Error {
  constructor(readonly current: SurfaceResidence) {
    super(`Surface residence revision conflict: ${current.surface}`);
    this.name = "SurfaceResidenceConflict";
  }
}

export class SurfaceResidenceLedger {
  private readonly claims = new Map<SurfaceKey, StoredClaim>();
  private readonly revisions = new Map<SurfaceKey, number>();

  get(rawSurface: unknown): SurfaceResidence {
    const surface = assertSurfaceKey(rawSurface);
    const claim = this.claims.get(surface);
    return {
      surface,
      windowId: claim?.windowId ?? null,
      claimRevision: claim?.claimRevision ?? this.revisions.get(surface) ?? 0,
    };
  }

  move(move: Move): SurfaceResidence {
    return this.moveMany([move])[0]!;
  }

  /** Validate the entire vector before writing any member; studio+use-chat therefore never split. */
  moveMany(moves: readonly Move[]): readonly SurfaceResidence[] {
    const normalized = moves.map((move) => ({
      ...move,
      surface: assertSurfaceKey(move.surface),
    }));
    const keys = new Set(normalized.map((move) => move.surface));
    if (keys.size !== normalized.length) {
      throw new Error("Duplicate surface in residence transaction");
    }
    for (const move of normalized) {
      const current = this.get(move.surface);
      if (current.claimRevision !== move.expectedRevision) {
        throw new SurfaceResidenceConflict(current);
      }
      if (move.windowId !== null && !move.windowId.trim()) {
        throw new Error("Invalid residence window id");
      }
    }
    return normalized.map((move) => this.commit(move.surface, move.windowId));
  }

  ownedBy(windowId: string): readonly SurfaceResidence[] {
    return [...this.claims.entries()]
      .filter(([, claim]) => claim.windowId === windowId)
      .map(([surface, claim]) => ({
        surface,
        windowId: claim.windowId,
        claimRevision: claim.claimRevision,
      }));
  }

  reclaimWindow(windowId: string): readonly SurfaceResidence[] {
    return this.ownedBy(windowId).map((claim) =>
      this.commit(claim.surface, null)
    );
  }

  private commit(surface: SurfaceKey, windowId: string | null) {
    const claimRevision = (this.revisions.get(surface) ?? 0) + 1;
    this.revisions.set(surface, claimRevision);
    if (windowId === null) this.claims.delete(surface);
    else this.claims.set(surface, { windowId, claimRevision });
    return { surface, windowId, claimRevision } satisfies SurfaceResidence;
  }
}
