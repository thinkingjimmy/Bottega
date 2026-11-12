/**
 * [INPUT]: Depends on i18n, the shared MCP server section and port, and the Settings page layout.
 * [OUTPUT]: Provides McpSettingsView for global MCP server management.
 * [POS]: Global Settings › MCP
 */


import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsPage } from "@/components/page-shell";
import {
  McpServersSection,
  useMcpServersPort,
} from "@/components/settings/tools/mcp-servers-section";
import { SettingsCanvas } from "@/components/settings/settings-layout";

export function McpSettingsView() {
  const { t } = useAppTranslation();
  const port = useMcpServersPort();
  return (
    <SettingsPage title={t("settings.tools.mcp.pageTitle")}>
      <SettingsCanvas>
        <McpServersSection port={port} />
      </SettingsCanvas>
    </SettingsPage>
  );
}
