/**
 * [INPUT]: Depends on shared AppGuiSurfaceTransitionCohort contract and live logical/runtime surface identities
 * [OUTPUT]: Provides 0..N cohort collection, freeze-closed admission, staging-only ready votes, close, ready quorum, and atomic swap projection
 * [POS]: gui-cutover live surface state; independent from durable App-global intent and disposable across restart
 */

import {
  appGuiSurfaceTransitionCohortSchema,
  type AppGuiSurfaceTransitionCohort,
  type AppGuiSurfaceTransitionMember,
} from "../../../../shared/app-gui/cutover";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";

export class AppGuiSurfaceCohort {
  private cohort: AppGuiSurfaceTransitionCohort;

  constructor(cutoverId: string) {
    this.cohort = appGuiSurfaceTransitionCohortSchema.parse({
      cutoverId,
      revision: 0,
      admission: "collecting",
      frozenRevision: null,
      members: [],
    });
  }

  snapshot() {
    return structuredClone(this.cohort);
  }

  /* 冻结后不再有人入列：迟到者由 coordinator 路由到 loading shell 等 App 全局
     结论。这里发出 GUI_COHORT_FROZEN 而不是伪造一个不在 cohort 里的成员——
     假成员会拿着 cutoverId 去投票，然后死在身份校验上。 */
  join(member: Omit<AppGuiSurfaceTransitionMember, "readyEvidenceDigest" | "state">) {
    if (this.cohort.admission === "closed") throw new Error("GUI_COHORT_CLOSED");
    const existing = this.cohort.members.find(
      (item) => item.logicalSurfaceId === member.logicalSurfaceId
    );
    if (existing) return existing;
    if (this.cohort.admission === "frozen") throw new Error("GUI_COHORT_FROZEN");
    return this.mutate((members) => {
      const joined = { ...member, readyEvidenceDigest: null, state: "staging" as const };
      members.push(joined);
      return joined;
    });
  }

  /* 只有仍在 staging 的成员能投票。投票者在 await frozen 期间可能已经关闭，
     无条件写回会把 closed 复活成 ready，让 quorum 认下一个已经不存在的 surface。 */
  ready(logicalSurfaceId: string, evidence: Sha256Digest) {
    return this.update(logicalSurfaceId, (member) =>
      member.state === "staging"
        ? { ...member, readyEvidenceDigest: evidence, state: "ready" }
        : member
    );
  }

  close(logicalSurfaceId: string) {
    return this.update(logicalSurfaceId, (member) => ({ ...member, state: "closed" }));
  }

  freeze() {
    if (this.cohort.admission === "frozen") return this.snapshot();
    if (this.cohort.admission !== "collecting") throw new Error("GUI_COHORT_CLOSED");
    this.cohort = appGuiSurfaceTransitionCohortSchema.parse({
      ...this.cohort,
      revision: this.cohort.revision + 1,
      admission: "frozen",
      frozenRevision: this.cohort.revision + 1,
    });
    return this.snapshot();
  }

  hasReadyQuorum() {
    if (this.cohort.admission !== "frozen") return false;
    return this.cohort.members.every(
      (member) => member.state === "ready" || member.state === "closed"
    );
  }

  swap() {
    if (!this.hasReadyQuorum()) throw new Error("GUI_COHORT_NOT_READY");
    this.cohort = appGuiSurfaceTransitionCohortSchema.parse({
      ...this.cohort,
      revision: this.cohort.revision + 1,
      admission: "closed",
      frozenRevision: null,
      members: this.cohort.members.map((member) =>
        member.state === "ready" ? { ...member, state: "swapped" as const } : member
      ),
    });
    return this.snapshot();
  }

  private update(
    logicalSurfaceId: string,
    apply: (member: AppGuiSurfaceTransitionMember) => AppGuiSurfaceTransitionMember
  ) {
    return this.mutate((members) => {
      const index = members.findIndex((item) => item.logicalSurfaceId === logicalSurfaceId);
      if (index < 0) throw new Error("GUI_COHORT_MEMBER_NOT_FOUND");
      members[index] = apply(members[index]!);
      return members[index]!;
    });
  }

  private mutate<R>(apply: (members: AppGuiSurfaceTransitionMember[]) => R) {
    const members = this.cohort.members.map((member) => ({ ...member }));
    const result = apply(members);
    this.cohort = appGuiSurfaceTransitionCohortSchema.parse({
      ...this.cohort,
      revision: this.cohort.revision + 1,
      members,
    });
    return structuredClone(result);
  }
}
