/**
 * [INPUT]: Depends on ProjectsService and incarnation-bound tools lease context
 * [OUTPUT]: Provides createProjectToolset, binding the static spec to the conver_chat_to_project to the cross-book saga
 * [POS]: The only adaptation layer to the common built-in tool platform in the projects area; The chat identity is only from lease, and the parameters cannot be falsified
 */

import type { BuiltinToolset } from "../tools/registry";
import type { ProjectsService } from "./projects-service";

export function createProjectToolset(
  projects: ProjectsService
): BuiltinToolset {
  return {
    convert_chat_to_project: (args, context) =>
      projects.convertFromChat({
        lease: context.lease,
        name: args.name as string,
      }),
  };
}
