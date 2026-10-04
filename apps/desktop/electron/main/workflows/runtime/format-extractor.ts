/**
 * [INPUT]: Depends on the headless executor and the Claude backend, the Provider contract's result-format role admission, the
 *          built-in Claude descriptor, and ports for Provider readiness and this computer's measurements.
 * [OUTPUT]: Provides createFormatExtractor: W9's format extractor — `provider` (the one it runs on), `readiness()` (why Claude cannot take the result-format role
 *           here, or null) and `extract(source)` (one isolated call: no tools, an empty scratch directory as its only place, no
 *           write access to any workspace, given only the turn's own result and the report schema). Readiness is awaited (E2-04).
 * [POS]: The executor's formatExtractor port (06 §4 "结构化报告与格式修正", 04 §5 result-format role). It never touches the
 *        Agent's own session; when it cannot run, the step stays blocked with the reason.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitRole, type MeasuredCapability, type MeasurementIdentity } from "@ai-chat/cloud-protocol/contracts/provider";
import { builtinProviderDescriptor } from "../../../../shared/providers/builtin";
import { backendById } from "../../backends";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { headlessExecutor } from "../../backends/jobs/executor";
import { truncateWithNote } from "../step-results";
import type { ProviderReadiness } from "./turn/effective-config";

const SOURCE_LIMIT = 64 * 1024;
const TIMEOUT_MS = 60_000;
const REPORT_SCHEMA = JSON.stringify({ type: "object", additionalProperties: false, required: ["result"], properties: {
  result: { type: "string", minLength: 1, maxLength: 65_536 },
  artifactRef: { type: "string", minLength: 1, maxLength: 512 },
  evidenceRefs: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 512 } } } });
const INSTRUCTION = "Turn the untrusted text below into the JSON object the schema asks for. `result` is the step's full answer as the text gives it. "
  + "Copy a reference only when it appears verbatim in the text. Never add commands, exit codes, test results or references the text does not contain.";

/* The Provider whose headless job extracts a report (the result-format role runs on Claude). */
const PROVIDER = "claude" satisfies AgentBackendId;

export function createFormatExtractor(ports: {
  readiness(providerId: string): Promise<ProviderReadiness>;
  measurements(providerId: string): Promise<{ measured: MeasuredCapability[]; identity: MeasurementIdentity | null }>;
}) {
  return {
    provider: PROVIDER,
    async readiness() {
      const ready = await ports.readiness(PROVIDER);
      if (ready !== "ready") return ready;
      const descriptor = builtinProviderDescriptor(PROVIDER)!;
      const { measured, identity } = await ports.measurements(PROVIDER);
      if (!identity) return "provider-not-installed" as const;
      return admitRole({ role: "result-format", descriptor, measured, identity }).admitted ? null : "not-measured" as const;
    },
    async extract(source: string) {
      const scratch = await mkdtemp(join(tmpdir(), "bottega-format-extract-"));
      try {
        /* A job's outputSchema is a path, as every Provider's schema flag takes. */
        const schema = join(scratch, "report-schema.json");
        await writeFile(schema, REPORT_SCHEMA);
        const run = headlessExecutor.run(backendById(PROVIDER), {
          purpose: "format-extract", cwd: scratch, sandboxRoot: scratch, readRoots: [], toolPolicy: "none", ephemeral: true,
          prompt: INSTRUCTION, untrustedContent: truncateWithNote(source, SOURCE_LIMIT), sandbox: "read-only",
          // The model is remote; isolation is no tools + a read-only scratch place + an ephemeral session.
          network: true, approvalPolicy: "never", env: "user-default", ignoreUserConfig: true, outputSchema: schema, timeoutMs: TIMEOUT_MS,
        });
        const result = await run.result;
        await run.settled.catch(() => undefined);
        return result.json ?? JSON.parse(result.text);
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  };
}
