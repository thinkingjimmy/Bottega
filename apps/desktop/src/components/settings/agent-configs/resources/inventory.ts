/**
 * [INPUT]: Depends on unified Skills snapshots and scoped MCP snapshot controllers.
 * [OUTPUT]: Provides useConfigResources with local availability, scope labels and refresh status.
 * [POS]: Read-only inventory for the Agent configuration editor; selected missing ids are retained by the selector.
 */
import { useEffect, useState } from "react";
import { listUnifiedSkills, onUnifiedSkillsChanged } from "@/lib/skills/unified-skills-client";
import { createMcpServersController } from "@/lib/clients/mcp-servers-client";
import type { ProjectOption } from "../available-in";

export type ResourceOption = { id: string; name: string; available: boolean; scope?: string };
export function useConfigResources(projects: readonly ProjectOption[], provider: string) {
  const [skills, setSkills] = useState<ResourceOption[]>([]);
  const [servers, setServers] = useState<ResourceOption[]>([]);
  const [skillResult, setSkillResult] = useState<{ revision: number; status: "ready" | "error" } | null>(null);
  const [mcpStatus, setMcpStatus] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const skillStatus: "loading" | "ready" | "error" = skillResult?.revision === revision ? skillResult.status : "loading";
  const projectKey = JSON.stringify(projects);
  useEffect(() => {
    let live = true;
    let sequence = 0;
    const adopt = (snapshot: Awaited<ReturnType<typeof listUnifiedSkills>>) => {
      if (!live) return;
      setSkills(snapshot.library.filter(item => item.ref.startsWith("library:")).map(item => ({
        id: item.ref, name: item.displayName || item.name,
        available: item.enabled && item.source.active && item.contentState === "ready",
      })));
      setSkillResult({ revision, status: "ready" });
    };
    const request = ++sequence;
    void listUnifiedSkills().then(value => { if (request === sequence) adopt(value); }, () => { if (live && request === sequence) setSkillResult({ revision, status: "error" }); });
    const stop = onUnifiedSkillsChanged(value => { sequence++; adopt(value); });
    return () => { live = false; stop(); };
  }, [revision]);
  useEffect(() => {
    const scopedProjects: readonly ProjectOption[] = JSON.parse(projectKey);
    const scopes = [createMcpServersController({ kind: "global" }), ...scopedProjects.map(project =>
      createMcpServersController({ kind: "project", projectId: project.id }))];
    const update = () => {
      const snapshots = scopes.map(controller => controller.getSnapshot());
      const options = new Map<string, ResourceOption>();
      for (const snapshot of snapshots) for (const server of snapshot.value?.servers ?? []) {
        const available = server.enabled && server.eligibility === "eligible" && server.backendSupport.some(item => item.backendId === provider && item.supported);
        const scope = server.owner.kind === "project" ? scopedProjects.find(project => server.owner.kind === "project" && project.id === server.owner.projectId)?.name : undefined;
        const previous = options.get(server.serverId);
        if (!previous || available) options.set(server.serverId, { id: server.serverId, name: server.displayName, available, scope });
      }
      setServers([...options.values()]);
      setMcpStatus(snapshots.some(item => item.loading || (!item.value && !item.error)) ? "loading" : snapshots.some(item => item.error) ? "error" : "ready");
    };
    const stops = scopes.map(controller => controller.subscribe(update));
    for (const controller of scopes) void controller.load();
    return () => { for (const stop of stops) stop(); };
  }, [projectKey, provider, revision]);
  return { skills, servers, skillStatus, mcpStatus, retry: () => setRevision(value => value + 1) };
}
