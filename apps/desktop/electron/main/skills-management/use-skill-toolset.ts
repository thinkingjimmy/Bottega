/**
 * [INPUT]: Depends on SkillsTurnCustodyStore and the builtin tool lease context
 * [OUTPUT]: Provides the use_skill builtin tool handler bound only to the custody referenced by the exact turn lease
 * [POS]: Thin non-ambient tool adapter; all identity, gate, materialization, and lifecycle logic stays in turn-custody
 */

import type { BuiltinToolset } from "../tools/registry";
import type { SkillsTurnCustodyStore } from "./turn-custody";

export function createUseSkillToolset(
  custodies: SkillsTurnCustodyStore
): BuiltinToolset {
  return {
    use_skill: (args, context) =>
      custodies.use(context.lease.skillsCustodyId, args.name as string),
  };
}
