/**
 * [INPUT]: Depends on the raw SHA-256 primitive, the shared package file budget and explicitly reviewed component byte transitions.
 * [OUTPUT]: Admits only five original component baselines advancing to their exact private or public release bytes.
 * [POS]: Component scaffolding compatibility leaf; callers verify snapshot trust and the base blob before preserving author source.
 */

import { PACKAGE_BUDGET } from "@ai-chat/cloud-protocol/apps/schemas/package-policy";
import { sha256 } from "../../support";

// These exact transitions change only reviewed documentation headers. Never derive admission from an App or input catalog.
const reviewedBaselines: Readonly<Record<string, readonly string[]>> = {
  // feedback
  "sha256:633aaeb9cb49b97ab518c3bd25f0ea55b6e4fef0cd8b87e4397e4e67ed725cea": [
    "sha256:18ef11bc5c60f207a60b66e737cbb2dcc427f9140378e5db53340516918eab2c",
    "sha256:d9d8cc3879f7868b9b1a2d802f6c13a6d0395012da0a80690771e224d4682c5e",
  ],
  // forms
  "sha256:4a56484d1c4dda9a0ac635e8df55b6f1c125884b1040ac11f61380b6068cbf03": [
    "sha256:8bf38f078f04983886b6dc4c536abeb87417a5cb60e499a8e3b38503ea9c0d63",
    "sha256:1b57d057bd9635ce33cec221a0da0afc79cb1d21137163f8ce10936e02168c98",
  ],
  // navigation
  "sha256:a4a9fe719a3ed0edbe912e126e07402d47a0b0a04e9280a33e08fb1e839187cc": [
    "sha256:93c806a1980d7c340acdc21667895794acd9120ed6397cecf8156d06d4b943ba",
    "sha256:e2af093922aac93e4bf9fbb937dae57a957bfd9bb38b7f6ec84bd4fcc72f6c2b",
  ],
  // overlays
  "sha256:6784060bc516e42adbd3437cfda65d2ab642a9f0092ac04c81023154286919fc": [
    "sha256:004c7befc94c0481d0c00babd5aad9428ce84bb7617bb55040c0ce9de66ab97c",
    "sha256:025869efcfd4595b884c1e4a03cf8eea21c24c95bf2ce8a9a4a0bb9bb5b59879",
  ],
  // surfaces
  "sha256:403c56b5af5b963880dd27d1a2e6038bae6def606996a1b474536b6d56e54863": [
    "sha256:81f13160968eab9ccdd6d01467fd67031a59eda337c877919f6c085d06768e44",
    "sha256:86649eaad5d1214cac3569c630231ddc7516afb9fe666e341cc4b7e88e890e71",
  ],
};

export function isReviewedComponentBaselineUpdate(base: Uint8Array, upstream: Uint8Array): boolean {
  if (base.byteLength > PACKAGE_BUDGET.fileBytes || upstream.byteLength > PACKAGE_BUDGET.fileBytes) return false;
  return reviewedBaselines[sha256(base)]?.includes(sha256(upstream)) ?? false;
}
