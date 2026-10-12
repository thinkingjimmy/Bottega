/**
 * [INPUT]: Node process APIs, isolated Bash descriptor limits and exact signer argv/environment/cwd.
 * [OUTPUT]: productionSignerArguments, spawnProductionSigner and probeProductionSignerResources with verified child descriptor admission.
 * [POS]: GitHub packaging resource boundary for the no-op preflight and electron-builder child; the caller's limits stay unchanged.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { constants } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ADMISSION = String.raw`set -euo pipefail
required=65536
soft=$(ulimit -S -n)
hard=$(ulimit -H -n)
case "$soft" in unlimited) ;; ''|*[!0-9]*) printf '[production-signer] invalid soft descriptor limit: %s\n' "$soft" >&2; exit 78 ;; esac
case "$hard" in unlimited) ;; ''|*[!0-9]*) printf '[production-signer] invalid hard descriptor limit: %s\n' "$hard" >&2; exit 78 ;; esac
if [ "$soft" != unlimited ] && [ "$soft" -lt "$required" ]; then
  if [ "$hard" != unlimited ] && [ "$hard" -lt "$required" ]; then
    printf '[production-signer] insufficient descriptor allowance: soft=%s hard=%s required=%s\n' "$soft" "$hard" "$required" >&2
    exit 78
  fi
  if ! ulimit -S -n "$required"; then
    printf '[production-signer] cannot admit descriptors: soft=%s hard=%s required=%s\n' "$soft" "$hard" "$required" >&2
    exit 78
  fi
fi
effective=$(ulimit -S -n)
case "$effective" in unlimited) ;; ''|*[!0-9]*) printf '[production-signer] invalid effective descriptor limit: %s\n' "$effective" >&2; exit 78 ;; esac
if [ "$effective" != unlimited ] && [ "$effective" -lt "$required" ]; then
  printf '[production-signer] descriptor admission failed: effective=%s required=%s\n' "$effective" "$required" >&2
  exit 78
fi
printf '[production-signer] descriptors inherited=%s soft=%s hard=%s required=%s\n' "$soft" "$effective" "$hard" "$required" >&2
case "$1" in
  */*)
    if [ ! -e "$1" ]; then printf '[production-signer] command does not exist: %s\n' "$1" >&2; exit 127; fi
    if [ ! -x "$1" ] || [ -d "$1" ]; then printf '[production-signer] command is not executable: %s\n' "$1" >&2; exit 126; fi
    ;;
  *) if ! command -v "$1" >/dev/null 2>&1; then printf '[production-signer] command does not exist: %s\n' "$1" >&2; exit 127; fi ;;
esac
exec "$@"
`;

export function productionSignerArguments(command, args = []) {
  assert(typeof command === "string" && command.length > 0 && Array.isArray(args) && args.every(argument => typeof argument === "string"),
    "Expected an exact signer command and string argument array");
  return ["--noprofile", "--norc", "-c", ADMISSION, "bottega-production-signer", command, ...args];
}

export function spawnProductionSigner(command, args = [], options = {}) {
  return spawnSync("/bin/bash", productionSignerArguments(command, args), { ...options, shell: false });
}

export function probeProductionSignerResources(options = {}) {
  const probe = "const {spawnSync}=require('node:child_process');" +
    "const result=spawnSync('/bin/bash',['--noprofile','--norc','-c','ulimit -S -n; ulimit -H -n'],{encoding:'utf8'});" +
    "if(result.status!==0)process.exit(result.status??1);" +
    "const [soft,hard]=result.stdout.trim().split('\\n');" +
    "process.stderr.write('[production-signer] node descriptors soft='+soft+' hard='+hard+' required=65536\\n');" +
    "if(soft!=='unlimited'&&Number(soft)<65536)process.exit(78);";
  return spawnProductionSigner(process.execPath, ["-e", probe], options);
}

const entryPath = process.argv[1];
if (entryPath && entryPath !== "-" && existsSync(resolve(entryPath)) &&
    pathToFileURL(realpathSync(resolve(entryPath))).href === import.meta.url) {
  const [command, ...args] = process.argv.slice(2);
  const result = spawnProductionSigner(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? (result.signal && constants.signals[result.signal] ? 128 + constants.signals[result.signal] : 1);
}
