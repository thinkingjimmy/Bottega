/**
 * [INPUT]: Depends on main-owned Project origin, scoped device names and shared localized execution copy.
 * [OUTPUT]: Shows the source computer for an unbound remote Project.
 * [POS]: Read-only sidebar label; the Project's local capability remains independent.
 */
import type { Project } from "../../../../shared/projects-ipc";
import { executionCopy } from "@ai-chat/chat-ui/execution-copy";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SidebarRowTag } from "@ai-chat/ui/components/workspace/row";
import { useCloudSidebar } from "./context";
export function ProjectOrigin({ project }: { project: Project }) {
  const { devices } = useCloudSidebar(), { i18n } = useAppTranslation(), copy = executionCopy(i18n.language);
  if (!project.cloud?.remote) return null;
  const name = devices.find(device => device.deviceId === project.cloud!.sourceDeviceId)?.name ?? copy.computer;
  return <SidebarRowTag>{copy.from.replace("{device}", name)}</SidebarRowTag>;
}
