/**
 * [INPUT]: Depends only on serializable Project identifiers and lifecycle revisions
 * [OUTPUT]: Provides the canonical ProductResourceScope, TurnProjectContext, ScopedResourceVersion, validators, and stable scope keys
 * [POS]: Shared scope vocabulary for Tools, Extensions, Skills, and Apps; no domain may declare a competing variant
 */

export type ProductResourceScope =
  | Readonly<{ kind: "global" }>
  | Readonly<{ kind: "project"; projectId: string }>;

export type TurnProjectContext = Readonly<{
  projectId: string | null;
  projectLifecycleRevision: number | null;
}>;

export type ScopedResourceVersion = Readonly<{
  scope: ProductResourceScope;
  projectLifecycleRevision: number | null;
  scopeRevision: number;
}>;

export const GLOBAL_PRODUCT_RESOURCE_SCOPE: ProductResourceScope = {
  kind: "global",
};

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

export function productResourceScopeKey(scope: ProductResourceScope) {
  return scope.kind === "global" ? "global" : `project:${scope.projectId}`;
}

export function sameProductResourceScope(
  left: ProductResourceScope,
  right: ProductResourceScope
) {
  return productResourceScopeKey(left) === productResourceScopeKey(right);
}

export function assertProductResourceScope(value: unknown): ProductResourceScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Resource scope invalid");
  }
  const input = value as { kind?: unknown; projectId?: unknown };
  if (input.kind === "global" && Object.keys(input).length === 1) {
    return GLOBAL_PRODUCT_RESOURCE_SCOPE;
  }
  if (
    input.kind === "project" &&
    Object.keys(input).length === 2 &&
    typeof input.projectId === "string" &&
    PROJECT_ID_PATTERN.test(input.projectId)
  ) {
    return { kind: "project", projectId: input.projectId };
  }
  throw new Error("Resource scope invalid");
}

export function assertTurnProjectContext(value: unknown): TurnProjectContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Turn Project context invalid");
  }
  const context = value as {
    projectId?: unknown;
    projectLifecycleRevision?: unknown;
  };
  if (
    context.projectId === null &&
    context.projectLifecycleRevision === null
  ) {
    return { projectId: null, projectLifecycleRevision: null };
  }
  if (
    typeof context.projectId === "string" &&
    PROJECT_ID_PATTERN.test(context.projectId) &&
    typeof context.projectLifecycleRevision === "number" &&
    Number.isSafeInteger(context.projectLifecycleRevision) &&
    context.projectLifecycleRevision > 0
  ) {
    return {
      projectId: context.projectId,
      projectLifecycleRevision: context.projectLifecycleRevision,
    };
  }
  throw new Error("Turn Project context invalid");
}
