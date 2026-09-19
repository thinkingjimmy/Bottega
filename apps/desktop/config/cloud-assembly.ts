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
