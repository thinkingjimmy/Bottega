/**
 * [INPUT]: DurableJson and strict public team snapshots.
 * [OUTPUT]: Atomic teams, members, task CAS and one message-consumption ledger.
 * [POS]: Feature-plugin durable state; Chat/process custody stays in the host session port.
 */
import { join } from "node:path";
import { z } from "zod";
import { pluginTeamSnapshotSchema, type PluginTeamSnapshot } from "@bottega/contracts/plugins/team";
import { DurableJson } from "../../persistence/durable-json";
const stateSchema = z.object({ schemaVersion: z.literal(1), teams: z.array(pluginTeamSnapshotSchema) }).strict()
  .superRefine((state, context) => {
    if (new Set(state.teams.map(team => team.id)).size !== state.teams.length)
      context.addIssue({ code: "custom", message: "Duplicate team identity" });
    const chats = state.teams.flatMap(team => team.members.map(member => member.chatId));
    if (new Set(chats).size !== chats.length) context.addIssue({ code: "custom", message: "A member Chat cannot belong to two teams" });
  });
export class PluginTeamStore {
  private readonly file: DurableJson<z.infer<typeof stateSchema>>;
  constructor(userData: string, private now: () => number) {
    this.file = new DurableJson(join(userData, "plugin-data", "team", "teams.json"), stateSchema, () => ({ schemaVersion: 1, teams: [] }));
  }
  initialize() { return this.file.initialize(); }
  list() { return this.file.read(state => state.teams); }
  get(teamId: string) { return this.file.read(state => state.teams.find(team => team.id === teamId) ?? null); }
  add(team: PluginTeamSnapshot) {
    return this.file.mutate(state => {
      const existing = state.teams.find(value => value.id === team.id);
      if (existing) return existing;
      state.teams.push(team); return team;
    });
  }
  update<R>(teamId: string, operation: (team: PluginTeamSnapshot) => R): Promise<R> {
    return this.file.mutate(state => {
      const team = state.teams.find(value => value.id === teamId);
      if (!team) throw new Error("Team is not available");
      const result = operation(team); team.revision++; team.updatedAt = this.now(); return result;
    });
  }
  close() { return this.file.closeAndFlush(); }
}
