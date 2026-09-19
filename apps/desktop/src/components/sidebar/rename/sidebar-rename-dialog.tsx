/**
 * [INPUT]: Shared rename dialog/focus handoff and native translation context.
 * [OUTPUT]: Native SidebarRenameDialog and useSidebarRenameMenu adapters.
 * [POS]: Sidebar entity rename boundary; shared UI owns draft, submission and focus behavior.
 */
import { SidebarRenameDialog as SharedRenameDialog, type SidebarRenameDialogProps } from "@ai-chat/ui/components/workspace/actions/rename";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export { useSidebarRenameMenu } from "@ai-chat/ui/components/workspace/actions/rename";
export function SidebarRenameDialog(props: Omit<SidebarRenameDialogProps, "copy">) {
  const { t } = useAppTranslation();
  return <SharedRenameDialog {...props} copy={{ cancel: t("common.cancel"), save: t("common.save") }} />;
}
