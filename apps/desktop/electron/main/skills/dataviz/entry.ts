/**
 * [INPUT]: Fixed original JS evaluator, shared report adapter and source-verified resource provenance.
 * [OUTPUT]: One bounded JSON palette report with actual process exit status on bundled Node.
 * [POS]: Self-contained palette-validator runtime entry; accepts data only and no paths or code.
 */
import * as engine from "../../../../resources/skills/dataviz/scripts/validate_palette.js";
import { paletteReport } from "../../../../resources/skills/dataviz/scripts/report-core.mjs";
import provenance from "../../../../resources/skills/dataviz/provenance.json";
const source = provenance.files.find(file => file.target === "scripts/validate_palette.js")!;
const report = paletteReport(process.argv.slice(2), engine, {
  version: "baoyu-design-2.7.1", gitBlob: source.gitBlob, sha256: source.sha256,
});
process.stdout.write(JSON.stringify(report) + "\n");
process.exitCode = report.exitStatus;
