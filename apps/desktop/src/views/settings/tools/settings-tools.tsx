/**
 * [INPUT]: Depends on i18n, React draft state, the shared MCP server body and port, Settings primitives and the Settings page layout.
 * [OUTPUT]: Provides McpSettingsView for global MCP server management — one page heading, its description, the header "Add" primary and the server list (S14).
 * [POS]: Global Settings › MCP
 */


import { useState } from "react";
import { Plus } from "lucide-react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsPage } from "@/components/page-shell";
import {
  blankMcpServerForm,
  McpServersSection,
  type McpServerFormState,
  useMcpServersPort,
} from "@/components/settings/tools/mcp-servers-section";
import { SettingsButton, SettingsCanvas } from "@/components/settings/settings-layout";

export function McpSettingsView() {
  const { t } = useAppTranslation();
  const port = useMcpServersPort();
  const [draft, setDraft] = useState<McpServerFormState | null>(null);
  return (
    <SettingsPage
      title={t("settings.tools.mcp.pageTitle")}
      description={t("settings.tools.mcp.globalDescription")}
      actions={
        /* 表单搬进弹窗后，「已经在填一张表」不再需要在这里防守：
           模态遮罩替这颗按钮挡住了那次点击，一个分支就此消失。 */
        <SettingsButton
          disabled={port.loading || !port.bridgeAvailable}
          onClick={() => setDraft(blankMcpServerForm())}
          variant="outline"
        >
          <Plus className="size-4" />
          {t("settings.tools.mcp.add")}
        </SettingsButton>
      }
    >
      <SettingsCanvas>
        <McpServersSection port={port} draft={draft} onDraftChange={setDraft} />
      </SettingsCanvas>
    </SettingsPage>
  );
}
