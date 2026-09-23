/**
 * [INPUT]: Depends on PageShell, Settings layout primitives, the external-link IPC, repository/issue/release URLs and Community i18n
 * [OUTPUT]: Provides CommunitySettingsView — the Settings › Community page of outbound project links
 * [POS]: Replaces the former About page; the product version and app updates live in Settings › Updates
 */

import type { ReactNode } from "react";
import { Bug, ExternalLink, ScrollText, Users } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { openExternal } from "@/lib/agent-client";
import { ISSUES_URL, REPOSITORY_URL } from "@/lib/report-issue";
import { RELEASE_URL } from "@/lib/update-client";

/* lucide dropped brand marks; this is GitHub's own mark, drawn in currentColor. */
function GitHubMark() {
  return <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>;
}

type Link = { key: string; label: string; description: string; action: string; icon: ReactNode; url: string };

export function CommunitySettingsView() {
  const { t } = useAppTranslation();
  const links: Link[] = [
    { key: "github", label: t("settings.community.github"), description: t("settings.community.githubDescription"),
      action: t("settings.community.viewOnGithub"), icon: <GitHubMark />, url: REPOSITORY_URL },
    { key: "issues", label: t("settings.community.issues"), description: t("settings.community.issuesDescription"),
      action: t("settings.community.openIssues"), icon: <Bug />, url: ISSUES_URL },
    { key: "releases", label: t("settings.community.releaseNotes"), description: t("settings.community.releaseNotesDescription"),
      action: t("settings.community.viewReleases"), icon: <ScrollText />, url: RELEASE_URL },
  ];
  return (
    <PageShell title={t("settings.community.title")} icon={<Users />}>
      <SettingsCanvas>
        <SettingsSection title={t("settings.community.title")} description={t("settings.community.description")}>
          <SettingsList>
            {links.map((link) => <SettingsRow key={link.key} label={link.label} description={link.description}
              control={<SettingsButton variant="outline" onClick={() => void openExternal(link.url)}>
                {link.icon}{link.action}<ExternalLink className="text-muted-foreground" />
              </SettingsButton>} />)}
          </SettingsList>
        </SettingsSection>
      </SettingsCanvas>
    </PageShell>
  );
}
