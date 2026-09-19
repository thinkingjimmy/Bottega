/**
 * [INPUT]: Native loading copy and the shared workspace skeleton list.
 * [OUTPUT]: SidebarLoadingRows with the existing native call signature.
 * [POS]: Native copy adapter for the common sidebar loading presentation.
 */
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { WorkspaceNavigationLoading } from "@ai-chat/ui/components/workspace/navigation/section";
export function SidebarLoadingRows({ rows = 3 }: { rows?: number }) {
  const { t } = useAppTranslation();
  return (
    <WorkspaceNavigationLoading label={t("common.loadingView")} rows={rows} />
  );
}
