/**
 * [INPUT]: Depends on authored configuration requirements and locally supplied App configuration.
 * [OUTPUT]: Validates required configuration without exposing values in errors or package data.
 * [POS]: Shared delivery validation for ordinary import and fixed-identity cloud installation.
 */
import type { AppConfigValue, AppRequirement } from "../../../../../shared/apps-ipc";
export function assertRequirements(requirements: readonly AppRequirement[], config: AppConfigValue) {
  for (const requirement of requirements) {
    if (requirement.kind === "config" && requirement.required && (!requirement.configKey || !config.values[requirement.configKey]?.trim())) {
      throw new Error(`APP_CONFIGURATION_REQUIRED: ${requirement.label}`);
    }
  }
}
