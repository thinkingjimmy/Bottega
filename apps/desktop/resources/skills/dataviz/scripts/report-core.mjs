/**
 * [INPUT]: Original validator functions, fixed script metadata and bounded CLI arguments.
 * [OUTPUT]: Exact normalized palette/surface/mode/pairs, input digest, individual rule verdicts and original exit status.
 * [POS]: Shared report adapter for the standalone CLI and the trusted desktop Node entry; owns no color formulas.
 */
import { createHash } from 'node:crypto';
const WS = /^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
const strip = value => value.replace(WS, '');
const normalize = value => '#' + value.replace(/^#/, '').toLowerCase();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const states = new Map([[true, 'PASS'], [false, 'FAIL'], ['pass', 'PASS'], ['floor', 'WARN'], ['fail', 'FAIL'], ['relief', 'WARN']]);

function parse(args) {
  if (args.some(value => typeof value !== 'string') || Buffer.byteLength(JSON.stringify(args)) > 8192) throw new Error('Palette arguments exceed the report budget');
  const options = {}; let positional;
  for (let index = 0; index < args.length; index++) {
    let flag = args[index], value;
    const equal = flag.indexOf('=');
    if (equal > 0) { value = flag.slice(equal + 1); flag = flag.slice(0, equal); }
    if (['--mode', '--surface', '--pairs'].includes(flag)) options[flag.slice(2)] = value ?? args[++index];
    else if (flag === '--ordinal') options.ordinal = true;
    else if (flag.startsWith('--')) throw new Error('Unknown flag: ' + flag);
    else if (positional === undefined) positional = flag;
    else throw new Error('Unexpected extra positional argument');
  }
  if (options.mode != null && !['light', 'dark'].includes(options.mode)) throw new Error('mode must be light or dark');
  if (options.pairs != null && !['adjacent', 'all'].includes(options.pairs)) throw new Error('pairs must be adjacent or all');
  const mode = options.mode || 'light';
  const surface = strip(options.surface ?? '') || (mode === 'light' ? '#fcfcfb' : '#1a1a19');
  const palette = (positional || '').split(',').map(strip).filter(Boolean);
  if (!palette.length || palette.length > 64) throw new Error('Palette must contain 1 to 64 colors');
  if ([...palette, surface].some(value => !/^#?[a-f\d]{6}$/i.test(value))) throw new Error('Colors must be six-digit hex values');
  return { palette: palette.map(normalize), surface: normalize(surface), mode, pairs: options.pairs || 'adjacent', ordinal: options.ordinal === true };
}

export function paletteReport(args, engine, script) {
  try {
    const input = parse(args);
    const result = input.ordinal ? engine.validateOrdinal(input.palette, input) : engine.validate(input.palette, input);
    const rules = result.report.map(([name, state, detail]) => {
      const status = states.get(state);
      if (!status) throw new Error('Unknown validator rule state');
      return { name, status, detail };
    });
    const status = rules.some(rule => rule.status === 'FAIL') ? 'FAIL' : rules.some(rule => rule.status === 'WARN') ? 'WARN' : 'PASS';
    return { schemaVersion: 1, ...input, inputDigest: digest(input), script, rules, status, exitStatus: result.ok ? 0 : 1 };
  } catch (error) {
    return { schemaVersion: 1, script, rules: [], status: 'ERROR', exitStatus: 2, inputDigest: digest(args), error: String(error instanceof Error ? error.message : error) };
  }
}
