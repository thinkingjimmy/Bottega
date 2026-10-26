/**
 * [INPUT]: Shared Sha256Digest type and the reviewed canonical commitment of the private admission corpus.
 * [OUTPUT]: Provides VALIDATOR_FIXTURE_DIGEST without importing test fixtures or computing a replacement identity.
 * [POS]: Production Extension admission evidence; private real-filesystem regressions verify the exact commitment against their corpus.
 */
import type { Sha256Digest } from "../../../../shared/ipc/settings/extensions-ipc";

export const VALIDATOR_FIXTURE_DIGEST: Sha256Digest = "sha256:d860c87909176b7d28ea26f8d046f26c28fefc5da79d50f905ecebef3312942d";
