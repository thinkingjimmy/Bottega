/**
 * [INPUT]: Depends on @ai-chat/cloud-protocol contracts/resources, the single public definition
 * [OUTPUT]: Re-exports the canonical ProductResourceScope, TurnProjectContext, ScopedResourceVersion, validators, and stable scope keys
 * [POS]: apps/desktop/shared/product; Desktop import path for the shared scope vocabulary of Tools, Extensions, Skills, and Apps; no domain may declare a competing variant
 */

export {
  GLOBAL_PRODUCT_RESOURCE_SCOPE,
  assertProductResourceScope,
  assertTurnProjectContext,
  productResourceScopeKey,
  sameProductResourceScope,
  type ProductResourceScope,
  type ScopedResourceVersion,
  type TurnProjectContext,
} from "@ai-chat/cloud-protocol/contracts/resources";
