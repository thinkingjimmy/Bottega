/**
 * [INPUT]: Controlled preference, localized choices and a host persistence callback.
 * [OUTPUT]: SettingsPreferenceSelect with shared theme/language geometry, optional locale flags, and a trigger the host may restyle or detach from a row description.
 * [POS]: Settings control presentation shared by Cloud Electron and Web.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/controls/select";
type PreferenceOption = { value: string; label: string; emoji?: string };
function OptionLabel({ option }: { option: PreferenceOption }) {
  return option.emoji ? (
    <span className="flex items-center gap-2">
      <span aria-hidden className="w-5 text-center text-base leading-none">
        {option.emoji}
      </span>
      <span>{option.label}</span>
    </span>
  ) : (
    option.label
  );
}
export function SettingsPreferenceSelect({
  id,
  label,
  value,
  options,
  disabled,
  className,
  describedBy = `${id}-description`,
  onValueChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly PreferenceOption[];
  disabled?: boolean;
  className?: string;
  /** The row description the trigger points at; null when it stands alone outside a Settings row. */
  describedBy?: string | null;
  onValueChange(value: string): void;
}) {
  const selected = options.find((option) => option.value === value);
  const flagged = options.some((option) => option.emoji);
  return (
    <Select value={value} disabled={disabled} onValueChange={onValueChange}>
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-describedby={describedBy ?? undefined}
        size="lg"
        className={className}
      >
        <SelectValue>
          {selected && <OptionLabel option={selected} />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="end"
        className={flagged ? "min-w-48 text-sm" : "text-sm"}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className={flagged ? "min-h-9 pr-9" : undefined}
          >
            <OptionLabel option={option} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
