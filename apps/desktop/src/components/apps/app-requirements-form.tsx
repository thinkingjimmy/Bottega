"use client";

/**
 * [INPUT]: Depends on shared requirements/AppConfigValue, Apps i18n, and controlled UI Input
 * [OUTPUT]: Provides AppRequirementsForm and appRequirementsSatisfied with secret-by-default configuration and explicit Agent-readable grants
 * [POS]: Shared Apps requirement editor used by preflight install and machine configuration surfaces
 */

import { Input } from "@ai-chat/ui/components/ui/input";
import type {
  AppConfigValue,
  AppRequirement,
} from "../../../shared/apps-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function appRequirementsSatisfied(
  requirements: readonly AppRequirement[],
  config: AppConfigValue
) {
  return requirements.every(
    (requirement) =>
      requirement.kind !== "config" ||
      !requirement.required ||
      Boolean(
        requirement.configKey &&
          config.values[requirement.configKey]?.trim()
      )
  );
}

export function AppRequirementsForm({
  requirements,
  value,
  onChange,
  disabled = false,
}: {
  requirements: readonly AppRequirement[];
  value: AppConfigValue;
  onChange: (value: AppConfigValue) => void;
  disabled?: boolean;
}) {
  const { t } = useAppTranslation();
  const configs = requirements.filter(
    (requirement) =>
      requirement.kind === "config" && requirement.configKey
  );
  if (!requirements.length) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("apps.requirements.none")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {requirements
        .filter((requirement) => requirement.kind !== "config")
        .map((requirement) => (
          <div className="rounded-lg border p-3 text-sm" key={requirement.id}>
            <p className="font-medium">
              {requirement.label}
              {t(
                requirement.required
                  ? "apps.requirements.required"
                  : "apps.requirements.optional"
              )}
            </p>
            <p className="text-muted-foreground">{requirement.note}</p>
          </div>
        ))}
      {configs.map((requirement) => {
        const key = requirement.configKey!;
        const readable = value.agentReadableKeys.includes(key);
        return (
          <label className="flex flex-col gap-1.5 text-sm" key={requirement.id}>
            <span className="font-medium">
              {requirement.label}
              {requirement.required ? " *" : ""}
            </span>
            <Input
              autoComplete="off"
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  values: { ...value.values, [key]: event.target.value },
                })
              }
              type="password"
              value={value.values[key] ?? ""}
            />
            <span className="text-muted-foreground text-xs">
              {requirement.note}
            </span>
            <span className="flex items-start gap-2 text-xs">
              <input
                checked={readable}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    agentReadableKeys: event.target.checked
                      ? [...new Set([...value.agentReadableKeys, key])]
                      : value.agentReadableKeys.filter((item) => item !== key),
                  })
                }
                type="checkbox"
              />
              <span>
                {t("apps.requirements.agentReadable")}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
