/**
 * [INPUT]: Depends on node: crypto and shared wire mutation operationsAuthority facts provided by BaseOwnerResolver/BasesService in main, plus the shared statusError constructor from main/errors
 * [OUTPUT]: Provides non-sequenced BaseCommitAuthority for every actor, app-gui scope fence and layered scope/revision scanning
 * [POS]: The submission-capability core of bases/service; the wire never carries an authority, real capability only ever exists in main memory
 */

import { randomUUID } from "node:crypto";
import type { BaseMutationOperation as WireMutationOperation } from "../../../../shared/bases-ipc";
import { statusError } from "../../errors";

const AUTHORITY = Symbol("BaseCommitAuthority");

export type BaseMutationOperation = WireMutationOperation;

export type BaseCommitAuthority = Readonly<{
  [AUTHORITY]: true;
  authorityId: string;
  actor: "renderer" | "agent" | "system" | "app-gui";
  ownerKey: string;
  ownerInstanceId: string;
  allowedOperations: readonly BaseMutationOperation[];
  expectedRevision: number | null;
  appFence?: Readonly<{
    appId: string;
    generationId: string;
    contentDigest: `sha256:${string}`;
    lifecycleRevision: number;
    capabilityDecisionId?: string | null;
    capabilityRevision?: number;
  }>;
}>;

export class BaseCommitAuthorityRegistry {
  issueRenderer(input: Omit<BaseCommitAuthority, typeof AUTHORITY | "authorityId" | "actor">) {
    return this.create({ ...input, actor: "renderer" });
  }

  issueAgent(input: Omit<BaseCommitAuthority, typeof AUTHORITY | "authorityId" | "actor">) {
    return this.create({ ...input, actor: "agent" });
  }

  issueSystem(input: Omit<BaseCommitAuthority, typeof AUTHORITY | "authorityId" | "actor">) {
    return this.create({ ...input, actor: "system" });
  }

  issueAppGui(input: Omit<BaseCommitAuthority, typeof AUTHORITY | "authorityId" | "actor">) {
    return this.create({ ...input, actor: "app-gui" });
  }

  assert(
    authority: BaseCommitAuthority,
    input: {
      ownerKey: string;
      ownerInstanceId: string;
      operation: BaseMutationOperation;
      revision: number;
    }
  ) {
    if (authority.actor === "app-gui") {
      throw statusError(403, "app-gui authority 必须走显式 live fence 校验");
    }
    /* 旧 actor 的 App surface fence 由签发它的 surface validator 负责；这里
       保持原合同。app-gui 则被上面的硬门强制走 assertScope(actual fence)。 */
    this.assertScope(authority, { ...input, appFence: authority.appFence });
    if (
      authority.expectedRevision !== null &&
      authority.expectedRevision !== input.revision
    ) {
      throw statusError(409, "Base commit authority revision 已变化");
    }
  }

  assertScope(
    authority: BaseCommitAuthority,
    input: {
      ownerKey: string;
      ownerInstanceId: string;
      operation: BaseMutationOperation;
      appFence?: NonNullable<BaseCommitAuthority["appFence"]>;
    }
  ) {
    if (!authority || authority[AUTHORITY] !== true) {
      throw statusError(403, "Base mutation 缺少 main-owned commit authority");
    }
    if (
      authority.ownerKey !== input.ownerKey ||
      authority.ownerInstanceId !== input.ownerInstanceId ||
      !authority.allowedOperations.includes(input.operation) ||
      !sameAppFence(authority.appFence, input.appFence)
    ) {
      throw statusError(409, "Base commit authority scope 已变化");
    }
  }

  private create(
    input: Omit<BaseCommitAuthority, typeof AUTHORITY | "authorityId"> & {
      actor: BaseCommitAuthority["actor"];
    }
  ): BaseCommitAuthority {
    return Object.freeze({
      ...input,
      authorityId: randomUUID(),
      [AUTHORITY]: true as const,
      allowedOperations: Object.freeze([...new Set(input.allowedOperations)]),
    });
  }
}

function sameAppFence(
  expected: BaseCommitAuthority["appFence"],
  actual: BaseCommitAuthority["appFence"]
) {
  if (!expected) return !actual;
  return Boolean(
    actual &&
      expected.appId === actual.appId &&
      expected.generationId === actual.generationId &&
      expected.contentDigest === actual.contentDigest &&
      expected.lifecycleRevision === actual.lifecycleRevision &&
      expected.capabilityDecisionId === actual.capabilityDecisionId &&
      expected.capabilityRevision === actual.capabilityRevision
  );
}
