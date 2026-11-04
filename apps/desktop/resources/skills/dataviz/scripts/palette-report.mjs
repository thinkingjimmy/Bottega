#!/usr/bin/env node
/**
 * [INPUT]: Original JS validator, actual source bytes and bounded palette CLI arguments.
 * [OUTPUT]: One machine-readable palette report and the original PASS/WARN/FAIL exit status.
 * [POS]: Standalone report entry; the desktop uses its separate digest-checked bundled Node entry.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as engine from './validate_palette.js';
import { paletteReport } from './report-core.mjs';
const script = { version: 'baoyu-design-2.7.1', gitBlob: '0529c4f9c3bdb689bfe8ee30327b78e99c94976a',
  sha256: createHash('sha256').update(readFileSync(new URL('./validate_palette.js', import.meta.url))).digest('hex') };
const report = paletteReport(process.argv.slice(2), engine, script);
process.stdout.write(JSON.stringify(report) + '\n');
process.exitCode = report.exitStatus;
