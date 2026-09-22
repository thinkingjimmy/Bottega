"use client";

/**
 * [INPUT]: Depends on i18n, the viewed-computer scope, the Projects provider, the shared dialog primitives and the computer switcher's presence label.
 * [OUTPUT]: Provides PinPicker — the dialog that pins another computer's Project into this computer's tab.
 * [POS]: The interaction half of section/pinned-remote, behind its own lazy boundary: the dialog exists only once
 *   the `+` menu asks for it, so the sidebar's first paint never carries a picker nobody has opened.
 */

import { Check } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import type { Project } from "../../../../../shared/projects-ipc";
import { useCloudSidebar } from "../../cloud/context";
import { computerPresenceLabel } from "@ai-chat/ui/components/account/computer-switcher";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { AppDialogBody, AppDialogContent, DialogChoice } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { computerOnline, type CloudComputer } from "@ai-chat/cloud-protocol";

/* Only a Project this computer could actually stand a row for: an App Project is run by its App, which is
   installed over there, and a Base custody record is not a place at all. Archived Projects are left out of the
   picker for the same reason the sidebar leaves them out — you pin a place you work in. */
const pinnable = (project: Project) =>
  project.role !== "base-custody" && project.workspaceBinding.kind !== "app" && !project.archivedAt && Boolean(project.cloud?.foreignSource);

const publishedBy = (computer: CloudComputer, project: Project) =>
  computer.installations.some(item => item.deviceId === project.cloud?.sourceDeviceId);

export function PinPicker({ open, onOpenChange, onCloseAutoFocus }: { open: boolean; onOpenChange(open: boolean): void; onCloseAutoFocus(event: Event): void }) {
  const { t, i18n } = useAppTranslation();
  const { scope } = useCloudSidebar();
  const { projects } = useProjects();
  const presence = { online: t("cloud.online"), offline: t("cloud.offline"), offlineSince: t("cloud.computers.offlineSince"), label: t("cloud.computers.label") };
  const groups = scope.computers
    .filter(computer => computer !== scope.self)
    .map(computer => ({ computer, rows: projects.filter(project => pinnable(project) && publishedBy(computer, project)) }))
    .filter(group => group.rows.length > 0);
  const toggle = (project: Project) => {
    if (scope.pinned.some(item => item.id === project.id)) {
      scope.unpin(project.id);
      return;
    }
    scope.pin({ id: project.id, name: project.name, deviceId: project.cloud?.sourceDeviceId ?? null });
    /* The pinned row lands in this computer's tab, so the strip comes back to show what just happened. */
    scope.selectLocal();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent data-pin-remote-project="" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader className="shrink-0 text-left">
          <DialogTitle className="text-xl/7 font-semibold">{t("projects.pin.title")}</DialogTitle>
          <DialogDescription className="mt-3 text-[15px]/[1.4]">{t("projects.pin.description")}</DialogDescription>
        </DialogHeader>
        <AppDialogBody className="mt-4 flex flex-col gap-4">
          {groups.length === 0 && <p className="text-muted-foreground text-sm">{t("projects.pin.empty")}</p>}
          {groups.map(({ computer, rows }) => {
            const online = computerOnline(computer, scope.now);
            const label = computerPresenceLabel({ machineIdHash: computer.machineIdHash, name: computer.name, online, lastSeenAt: computer.lastSeenAt },
              presence, i18n.language);
            return (
              <section key={computer.machineIdHash} className="flex flex-col gap-1">
                {/* The heading reads like the switcher tab it stands for: the name, and the same dot or moment. */}
                <h3 className="flex items-center gap-2 px-2.5 text-[11px] text-muted-foreground leading-none">
                  {online ? <span aria-label={label} className="size-2 shrink-0 rounded-full bg-emerald-500" /> : null}
                  <span className="min-w-0 truncate">{computer.name}</span>
                  {online ? null : <span className="shrink-0 opacity-70">{label}</span>}
                </h3>
                {rows.map(project => {
                  const pinned = scope.pinned.some(item => item.id === project.id);
                  return (
                    <DialogChoice
                      key={project.id}
                      variant="plain"
                      size="sm"
                      selected={pinned}
                      aria-pressed={pinned}
                      icon={<Check className={pinned ? "opacity-100" : "opacity-0"} />}
                      title={<span className="min-w-0 truncate">{project.name}</span>}
                      onClick={() => toggle(project)}
                    />
                  );
                })}
              </section>
            );
          })}
        </AppDialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
