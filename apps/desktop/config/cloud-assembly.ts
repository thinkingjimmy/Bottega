import { cloudBuildConfigSchema, type CloudBuildConfig } from "../../../packages/cloud-protocol/src/config/index";
export type CloudAssembly = { flavor: "production"; config: CloudBuildConfig; updatesEnabled: true };
const productionConfig: CloudBuildConfig = {
  environmentId: "cloud-production", deploymentId: "clean-cricket-785", appOrigin: "https://app.getbottega.app",
  authOrigin: "https://app.getbottega.app", convexUrl: "https://clean-cricket-785.convex.cloud",
  httpOrigin: "https://clean-cricket-785.convex.site", callbackScheme: "bottega",
};
export function resolveCloudAssembly(flavor: string | undefined = "production"): CloudAssembly {
  if (flavor !== "production") throw new Error("Public builds require the production cloud assembly");
  const config = cloudBuildConfigSchema.parse(productionConfig);
  if (config.environmentId !== "cloud-production") throw new Error("Invalid production cloud assembly");
  return { flavor, config, updatesEnabled: true };
}
/** Production ships with the workbench UI on; only BOTTEGA_WORKBENCH_UI=0 builds it without. */
export function workbenchUiFor(_assembly: Pick<CloudAssembly, "flavor">, flag: string | undefined) {
  return flag !== "0";
}
export function serverTunnelFor(_assembly: Pick<CloudAssembly, "flavor">, flag: string | undefined) {
  if (flag && flag !== "0") throw new Error("Server tunnels cannot be enabled in production");
  return false;
}
