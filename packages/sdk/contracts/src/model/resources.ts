/**
 * [INPUT]: Depends on Zod, the Base owner-key grammar in core/owner-key and the protocol opaque-id scalar.
 * [OUTPUT]: Provides the canonical ProductResourceScope/TurnProjectContext/ScopedResourceVersion with validators and keys, plus ChatRef, BaseRef, ProjectRef, opaque WorkspaceRef and ExecutionTarget schemas.
 * [POS]: The single public resource-identity vocabulary; desktop `shared/product-resource-scope.ts` re-exports it and no domain may declare a competing variant, a workspace-binding counter or a baseId mapping.
 */
import { z } from "zod";
import { BASE_OWNER_KEY_PATTERN, type BaseOwnerKey } from "../core/owner-key";
import { id } from "../core/scalars";

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

export const GLOBAL_PRODUCT_RESOURCE_SCOPE: ProductResourceScope = { kind: "global" };

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

export function productResourceScopeKey(scope: ProductResourceScope) {
  return scope.kind === "global" ? "global" : `project:${scope.projectId}`;
}

export function sameProductResourceScope(left: ProductResourceScope, right: ProductResourceScope) {
  return productResourceScopeKey(left) === productResourceScopeKey(right);
}

export function assertProductResourceScope(value: unknown): ProductResourceScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Resource scope invalid");
  const input = value as { kind?: unknown; projectId?: unknown };
  if (input.kind === "global" && Object.keys(input).length === 1) return GLOBAL_PRODUCT_RESOURCE_SCOPE;
  if (input.kind === "project" && Object.keys(input).length === 2 && typeof input.projectId === "string" &&
    PROJECT_ID_PATTERN.test(input.projectId)) return { kind: "project", projectId: input.projectId };
  throw new Error("Resource scope invalid");
}

export function assertTurnProjectContext(value: unknown): TurnProjectContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Turn Project context invalid");
  const context = value as { projectId?: unknown; projectLifecycleRevision?: unknown };
  if (context.projectId === null && context.projectLifecycleRevision === null) {
    return { projectId: null, projectLifecycleRevision: null };
  }
  if (typeof context.projectId === "string" && PROJECT_ID_PATTERN.test(context.projectId) &&
    typeof context.projectLifecycleRevision === "number" && Number.isSafeInteger(context.projectLifecycleRevision) &&
    context.projectLifecycleRevision > 0) {
    return { projectId: context.projectId, projectLifecycleRevision: context.projectLifecycleRevision };
  }
  throw new Error("Turn Project context invalid");
}

/* ============================================================
 * Serializable refs. Each wraps identity that already exists:
 * a Chat is (chatId, incarnationId); a Base is (ownerKey,
 * ownerInstanceId) and the cloud baseId IS ownerInstanceId.
 * ============================================================ */
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const productResourceScopeSchema = z.custom<ProductResourceScope>(value => {
  try { assertProductResourceScope(value); return true; } catch { return false; }
}, "Resource scope invalid");
export const chatRefSchema = z.object({ chatId: id, incarnationId: id }).strict();
export type ChatRef = Readonly<z.infer<typeof chatRefSchema>>;
export const baseRefSchema = z.object({
  ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN).transform(value => value as BaseOwnerKey),
  ownerInstanceId: id,
}).strict();
export type BaseRef = Readonly<z.output<typeof baseRefSchema>>;
export const projectRefSchema = z.object({ projectId: z.string().regex(PROJECT_ID_PATTERN), projectLifecycleRevision: revision }).strict();
export type ProjectRef = Readonly<z.infer<typeof projectRefSchema>>;
/** Host-issued alias for a resolved workspace; never an absolute path and never a permission by itself. */
export const workspaceRefSchema = z.string().regex(/^wsr_[A-Za-z0-9_-]{22,64}$/);
export type WorkspaceRef = z.infer<typeof workspaceRefSchema>;

/**
 * Where an execution runs, composed only from existing facts. The host expands it and compares the
 * current authorityIdentity / bindingCustodyId and capability; there is no workspace-binding counter.
 */
export const executionTargetSchema = z.object({
  ownerDeviceId: id,
  scope: productResourceScopeSchema,
  projectLifecycleRevision: revision.nullable(),
  membershipRevision: revision.nullable(),
  workspaceRef: workspaceRefSchema.nullable(),
}).strict().refine(value => (value.scope.kind === "project") === (value.projectLifecycleRevision !== null) &&
  (value.scope.kind === "project") === (value.membershipRevision !== null), "execution-target-scope-mismatch");
export type ExecutionTarget = Readonly<z.infer<typeof executionTargetSchema>>;
