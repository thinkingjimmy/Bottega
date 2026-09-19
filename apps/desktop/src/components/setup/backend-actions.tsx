/**
 * [INPUT]: Depends on Setup actions, the shared row projection and accessible UI menus.
 * [OUTPUT]: Provides prioritized repair actions and secondary Agent management.
 * [POS]: Detailed Settings actions; optional management stays in one menu.
 */
import { Download, LogIn, MoreHorizontal, RefreshCw } from "lucide-react";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import type { BackendInfo } from "../../../shared/agent-ipc";
import { BackendIconAction, type BackendSetupPresentation } from "./backend-parts";

export function BackendActions({ backend, presentation }: { backend: BackendInfo; presentation: BackendSetupPresentation }) {
  const setup = useSetup();
  const { t } = useAppTranslation();
  const busy = Boolean(setup.busy[backend.id]);
  const checking = presentation.refreshing || setup.busy[backend.id] === "recheck" || Boolean(setup.latestChecking[backend.id]);
  const locked = busy || presentation.refreshing || Boolean(backend.setupAction);
  const repair = ["check-failed", "cannot-check", "cannot-start"].includes(presentation.status);
  const menu = presentation.loginAction === "manage" || (presentation.canUpdate && !presentation.requiresUpdate) || presentation.canReinstall;
  return <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
    {presentation.canInstall && <SettingsButton variant="outline" disabled={locked} onClick={() => void setup.terminalAction(backend.id, "install")}><Download />{t("setup.install")}</SettingsButton>}
    {presentation.loginAction === "login" && <SettingsButton variant="outline" disabled={locked} onClick={() => void setup.terminalAction(backend.id, "login")}><LogIn />{t("setup.login")}</SettingsButton>}
    {presentation.requiresUpdate && <SettingsButton variant="outline" disabled={locked} title={backend.latestVersion}
      aria-label={t("setup.updateAria", { backend: backend.displayName })} onClick={() => void setup.terminalAction(backend.id, "update")}><Download />{t("setup.updateNow")}</SettingsButton>}
    {repair ? <SettingsButton variant="outline" aria-label={t("setup.recheck", { backend: backend.displayName })}
      disabled={busy || checking} onClick={() => void setup.recheckBackend(backend.id)}>
      <RefreshCw className={checking ? "animate-spin motion-reduce:animate-none" : undefined} />{t("setup.checkAgain")}
    </SettingsButton> : <BackendIconAction label={t("setup.recheck", { backend: backend.displayName })} disabled={busy || checking} onClick={() => void setup.recheckBackend(backend.id)}>
      <RefreshCw className={checking ? "animate-spin motion-reduce:animate-none" : undefined} />
    </BackendIconAction>}
    {menu && <DropdownMenu><DropdownMenuTrigger asChild>
      <Button size="icon-sm" variant="ghost" disabled={locked} aria-label={t("setup.more", { backend: backend.displayName })}><MoreHorizontal /></Button>
    </DropdownMenuTrigger><DropdownMenuContent align="end">
      {presentation.loginAction === "manage" && <DropdownMenuItem onSelect={() => void setup.terminalAction(backend.id, "login")}><LogIn />{t("setup.manageLogin")}</DropdownMenuItem>}
      {presentation.canUpdate && !presentation.requiresUpdate && <DropdownMenuItem onSelect={() => void setup.terminalAction(backend.id, "update")}><Download />{t("setup.update")}</DropdownMenuItem>}
      {presentation.canReinstall && <DropdownMenuItem onSelect={() => void setup.terminalAction(backend.id, "install")}><Download />{t("setup.reinstall")}</DropdownMenuItem>}
    </DropdownMenuContent></DropdownMenu>}
  </div>;
}
