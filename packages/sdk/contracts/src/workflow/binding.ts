/**
 * [INPUT]: Depends on Zod and the Base part of a binding.
 * [OUTPUT]: Provides workflowBindingSchema: a Project's binding of the built-in recipe to one Base (by id), the Agent configuration chosen for each role, and the Project's computer as the owner; state draft / enabled / disabled / suspended (always with a reason).
 * [POS]: The binding half of the workflow contracts: no field mapping, no chosen computer, each role's configuration is stored by id only; a run resolves its latest revision at start and freezes it, with no stored revision copies.
 */
import { z } from "zod";
import { baseBindingSchema } from "../base/binding";
import { WORKFLOW_ROLES } from "./recipe";

const id = z.string().min(1).max(128);
export const BINDING_STATES = ["draft", "enabled", "disabled", "suspended"] as const;
export const workflowBindingSchema = z.object({
  bindingId: id,
  projectId: id,
  recipe: z.object({ recipeId: z.string().min(1).max(64), version: z.number().int().positive() }).strict(),
  base: baseBindingSchema,
  /** One Agent configuration per role, resolved `latest` when a run starts. */
  roles: z.object(Object.fromEntries(WORKFLOW_ROLES.map(role => [role, z.object({ configId: id }).strict()])) as
    Record<(typeof WORKFLOW_ROLES)[number], z.ZodObject<{ configId: typeof id }>>).strict(),
  /** Always the computer that holds the Project; the user does not choose it. */
  ownerDeviceId: id,
  state: z.enum(BINDING_STATES),
  suspendedReason: z.string().min(1).max(64).nullable(),
  revision: z.number().int().min(0),
}).strict().refine(value => (value.state === "suspended") === (value.suspendedReason !== null), "suspended-needs-reason");
export type WorkflowBinding = z.infer<typeof workflowBindingSchema>;
