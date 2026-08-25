/**
 * [INPUT]: Depends on Extension integration with Registry, Codex Skills service, UnifiedSkillsService and the obvious userData/home/env/folder chooser
 * [OUTPUT]: Provides createUnifiedSkillsService, only synchronously initializing durable libraries/saga; HOME candidate found to be executed by service after readiness
 * [POS]: The company is a leading provider of united Skills and stateless combined plants for startupsindex determines the order of resources, window only consumes service ready
 */

import type { AppExtensionIntegration } from "../extensions/integration/app-extension-composition";
import type { CodexSkillsService } from "../backends/codex/skills-service";
import { UnifiedSkillsService } from "../skills-management/service";

export async function createUnifiedSkillsService(input: Readonly<{
  userData: string;
  userHome: string;
  env: NodeJS.ProcessEnv;
  extensions: AppExtensionIntegration;
  codex: CodexSkillsService;
  chooseLocalFolder(): Promise<string | null>;
}>) {
  const service = new UnifiedSkillsService({
    userData: input.userData,
    userHome: input.userHome,
    env: input.env,
    registry: input.extensions.registry,
    codex: input.codex,
    chooseLocalFolder: input.chooseLocalFolder,
  });
  await service.initialize();
  return service;
}
