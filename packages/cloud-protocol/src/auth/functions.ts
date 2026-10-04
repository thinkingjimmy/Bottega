/**
 * [INPUT]: Depends on closed account/device/environment schemas, immutable spaces, continuity and business registries (including account-config).
 * [OUTPUT]: Provides cloudFunctions, the merged public function registry (every domain table plus core-functions.ts), with typed arguments/results.
 * [POS]: Shared contract authority; private Convex exports are verified against this registry. Desktop and services use it whole; Cloud Web imports only
 *        the domain tables it uses (OPT-31), and tests/platform/function-tables.test.ts proves the union of the tables is exactly this registry.
 */
import { z } from "zod";
import { coreFunctions } from "./core-functions";
import { baseFunctions } from "../bases/functions";
import { blobFunctions } from "../blobs/functions";
import { appFunctions } from "../apps/functions";
import { projectFunctions } from "../projects/functions";
import { chatFunctions } from "../chats/functions";
import { chatTranscriptFunctions } from "../chats/transcript/functions";
import { homeFunctions } from "../chats/home/functions";
import { importedFunctions } from "../chats/imported/functions";
import { turnFunctions } from "../turns/functions";
import { lifecycleFunctions } from "../lifecycle/functions";
import { remoteFunctions } from "../remote/functions";
import { continuityFunctions } from "../continuity/functions";
import { spacesFunctions } from "../spaces/functions";
import { skillFunctions } from "../skills/functions";
import { accountConfigFunctions } from "../account-config/functions";
import { agentConfigFunctions } from "../agent-config/functions";
import { workflowFunctions } from "../workflows/functions";
import { resourceFunctions } from "../resources/functions";
import { previewFunctions } from "../resources/preview";
import { pushFunctions } from "../push/functions";
import { surfaceFunctions } from "../surfaces/functions";
import { memoryControlFunctions } from "../remote/memory-control/model";
export const cloudFunctions = {
  ...previewFunctions,
  ...memoryControlFunctions,
  ...skillFunctions,
  ...accountConfigFunctions,
  ...agentConfigFunctions,
  ...workflowFunctions,
  ...resourceFunctions,
  ...pushFunctions,
  ...spacesFunctions,
  ...continuityFunctions,
  ...remoteFunctions,
  ...lifecycleFunctions,
  ...baseFunctions,
  ...blobFunctions,
  ...appFunctions,
  ...surfaceFunctions,
  ...projectFunctions,
  ...chatFunctions,
  ...chatTranscriptFunctions,
  ...homeFunctions,
  ...importedFunctions,
  ...turnFunctions,
  ...coreFunctions,
} as const;
export type CloudFunctionName = keyof typeof cloudFunctions;
export type CloudFunctionArgs<N extends CloudFunctionName> = z.infer<(typeof cloudFunctions)[N]["args"]>;
export type CloudFunctionResult<N extends CloudFunctionName> = z.infer<(typeof cloudFunctions)[N]["result"]>;
