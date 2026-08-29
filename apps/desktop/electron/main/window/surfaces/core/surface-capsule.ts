/**
 * [INPUT]: Depends on shared SurfaceCapsuleV1 plus exact App Studio surface/route validation
 * [OUTPUT]: Provides assertSurfaceCapsule with a bounded plain-data codec that rejects malformed capsules and can replace a stale source pathname with a main-validated migration target
 * [POS]: Window surfaces core serialization gate; renderer-owned live objects never cross the window boundary
 */

import {
  appIdFromStudioSurface,
  assertAppSurfaceRoute,
  type SurfaceCapsuleV1,
} from "../../../../../shared/window-surfaces-ipc";

const MAX_CAPSULE_BYTES = 256 * 1024;
const MAX_DEPTH = 24;

export function assertSurfaceCapsule(
  value: unknown,
  targetPathname?: string
): SurfaceCapsuleV1 {
  assertPlainCloneData(value, new Set(), new Set(), 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MAX_CAPSULE_BYTES) {
    throw new Error("Surface capsule exceeds byte budget");
  }
  const capsule = value as Partial<SurfaceCapsuleV1>;
  if (capsule.version !== 1) throw new Error("Unsupported surface capsule");
  const appId = appIdFromStudioSurface(capsule.surface);
  if (!capsule.route || typeof capsule.route.pathname !== "string") {
    throw new Error("Invalid surface capsule route");
  }
  const pathname = targetPathname === undefined
    ? assertAppSurfaceRoute(capsule.route.pathname, appId)
    : assertAppSurfaceRoute(targetPathname, appId);
  return pathname === capsule.route.pathname
    ? value as SurfaceCapsuleV1
    : {
        ...(value as SurfaceCapsuleV1),
        route: { ...capsule.route, pathname },
      } as SurfaceCapsuleV1;
}

function assertPlainCloneData(
  value: unknown,
  ancestors: Set<object>,
  visited: Set<object>,
  depth: number
) {
  if (depth > MAX_DEPTH) throw new Error("Surface capsule is too deeply nested");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Surface capsule contains a non-finite number");
    return;
  }
  if (typeof value !== "object") throw new Error("Surface capsule contains non-clone data");
  if (ancestors.has(value)) throw new Error("Surface capsule contains a cycle");
  /* 共享引用在合法胶囊里没有用途，却让路径数指数增长（结构化克隆会保留
     共享引用，恶意 renderer 用 ~1KB 图即可冻结 main）。整体去重，线性收尾。 */
  if (visited.has(value)) throw new Error("Surface capsule contains a shared reference");
  visited.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error("Surface capsule contains a native or class object");
  }
  ancestors.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) assertPlainCloneData(child, ancestors, visited, depth + 1);
  ancestors.delete(value);
}
