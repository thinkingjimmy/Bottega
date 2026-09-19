"use client";
/**
 * [INPUT]: React lazy/Suspense, shared search presentation, localized copy and native action callbacks.
 * [OUTPUT]: CommandPalette with immediate editable loading UI and on-demand native search content.
 * [POS]: Lightweight native search entry; query custody survives loading and ends when the dialog closes.
 */
import { lazy, Suspense, useState } from "react";
import {
  SearchDialog,
  SearchNotice,
  SearchPalette,
} from "@ai-chat/ui/components/search/palette";
import { useCoarsePointer } from "@ai-chat/ui/hooks/use-mobile";
import { useAppTranslation } from "@/components/providers/i18n-provider";

const CommandSearchContent = lazy(() =>
  import("./command-content").then((module) => ({
    default: module.CommandSearchContent,
  })),
);
type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  onNewChat(): void;
  onOpenSettings(): void;
};
export function CommandPalette(props: Props) {
  const { t } = useAppTranslation();
  return (
    <SearchDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t("history.search")}
      description={t("history.searchPlaceholder")}
    >
      {props.open && <SearchSession {...props} />}
    </SearchDialog>
  );
}
function SearchSession(props: Props) {
  const { t } = useAppTranslation();
  const [query, setQuery] = useState("");
  const touch = useCoarsePointer();
  // Keep typing available while the local chunk loads; closing discards this session.
  return (
    <Suspense
      fallback={
        <SearchPalette
          query={query}
          onQueryChange={setQuery}
          label={t("history.search")}
          placeholder={t("history.searchPlaceholder")}
          busy
        >
          <SearchNotice role="status">{t("common.loading")}</SearchNotice>
        </SearchPalette>
      }
    >
      <CommandSearchContent
        {...props}
        query={query}
        setQuery={setQuery}
        autoFocus={!touch}
      />
    </Suspense>
  );
}
