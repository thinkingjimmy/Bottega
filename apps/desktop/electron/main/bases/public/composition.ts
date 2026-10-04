/**
 * [INPUT]: Depends on BasesService, the OperationRegistry and the guard, grant and run-result stores
 * [OUTPUT]: Provides composeBasePublicPorts (initialize the durable guard key, grants and result index; register the `base.*` operations) and BasePublicRuntime
 * [POS]: The single startup seam of the Base public ports, called from startup/foundation after the operation layer exists
 */
import { join } from "node:path";
import type { BasesService } from "../bases-service";
import type { OperationRegistry } from "../../operations/registry";
import { FieldGuardSigner } from "./guard";
import { BaseGrantStore } from "./grants";
import { RunResultStore } from "./results";
import { BasePublicPorts } from "./ports";
import { registerBaseOperations } from "./operations";

export type BasePublicRuntime = Awaited<ReturnType<typeof composeBasePublicPorts>>;

export async function composeBasePublicPorts(input: { userData: string; service: BasesService; registry: OperationRegistry }) {
  const guards = new FieldGuardSigner(join(input.userData, "bases", "public-guard.key"));
  const grants = new BaseGrantStore(input.userData);
  const results = new RunResultStore(input.userData);
  await Promise.all([guards.initialize(), grants.initialize(), results.initialize()]);
  const ports = new BasePublicPorts({ service: input.service, guards, grants, results });
  registerBaseOperations(input.registry, ports);
  return { ports, grants, results, service: input.service, close: async () => { await Promise.all([grants.close(), results.close()]); } };
}
