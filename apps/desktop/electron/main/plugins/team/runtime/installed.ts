/**
 * [INPUT]: The erased PluginTeamService type only.
 * [OUTPUT]: installedPluginTeams and installPluginTeamService for the one feature runtime.
 * [POS]: Cold main lifecycle lookup; feature composition owns service creation and cleanup.
 */
import type { PluginTeamService } from "../service";
let installedTeamService: PluginTeamService | null = null;
export const installedPluginTeams = () => installedTeamService;
export const installPluginTeamService = (service: PluginTeamService | null) => { installedTeamService = service; };
