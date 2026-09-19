/**
 * [INPUT]: Depends on the shared Input, search icon, and Skills translations
 * [OUTPUT]: Provides a controlled SkillSearch field with one label, size, and icon alignment
 * [POS]: Shared search presentation for global and Project Skills settings
 */

import { Search } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Input } from "@ai-chat/ui/components/ui/input";

export function SkillSearch({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="relative ml-auto w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={t("settings.skills.search")}
        className="pl-9"
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("settings.skills.search")}
        value={value}
      />
    </div>
  );
}
