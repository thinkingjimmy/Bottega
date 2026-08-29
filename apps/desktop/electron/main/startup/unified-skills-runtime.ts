/**
 * [INPUT]: Depends on initialized Extension integration, BackendRuntimeRegistry, SkillsCatalog, UnifiedSkillsService, and userData/home/env/folder chooser
 * [OUTPUT]: Provides createUnifiedSkillsService with durable Library-first initialization, installed-runtime authority, and catalog invalidation wiring
 * [POS]: Post-cutover startup composition for Unified Skills; it contains no Codex-native or projection bridge
 */

import type { AppExtensionIntegration } from "../extensions/integration/app-extension-composition";
import { UnifiedSkillsService } from "../skills-management/service";
import type { SkillsCatalog } from "../skills-catalog";
import { backendRuntimeRegistry } from "../backends";
import type { LibraryCustodyProbe } from "../skills-management/library-store";

export async function createUnifiedSkillsService(input: Readonly<{
  userData: string;
  userHome: string;
  env: NodeJS.ProcessEnv;
  extensions: AppExtensionIntegration;
  catalog: SkillsCatalog;
  custodyReferenced?: LibraryCustodyProbe;
  chooseLocalFolder(): Promise<string | null>;
}>) {
  const service = new UnifiedSkillsService({
    userData: input.userData,
    userHome: input.userHome,
    env: input.env,
    registry: input.extensions.registry,
    runtimeRegistry: backendRuntimeRegistry,
    invalidateCatalog: () => input.catalog.invalidate(),
    custodyReferenced: input.custodyReferenced,
    chooseLocalFolder: input.chooseLocalFolder,
  });
  await service.initialize();
  return service;
}
