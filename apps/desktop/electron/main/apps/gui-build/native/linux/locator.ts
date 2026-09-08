/**
 * [INPUT]: Depends on signed-release Linux payload records, root-owned byte inspection, and fixed distro/package observations
 * [OUTPUT]: Resolves admitted system bytes or an exact stable installation; system AppArmor authority requires fresh kernel behavior evidence
 * [POS]: Compiler Linux component selector; packaged payloads are never treated as executable admission
 */

import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";
import {
  inspectTrustedFile, inspectProductFile, linuxPayloadSchema, sha256, stablePaths, stableProfile, verifyArtifact,
  type InspectTrustedFile, type LinuxPayload,
} from "./trust";

const execute = promisify(execFile);
export const LINUX_COMPONENT_ROOT = "/opt/bottega/runtime/bwrap";
const activeSchema = z.object({
  schema: z.literal("bottega.compiler-linux-active/v1"),
  payloadId: z.string().regex(/^bwrap-[a-f0-9]{64}$/),
  binarySha256: z.string(), profileSha256: z.string(),
}).strict();

export type LinuxSandboxIdentity = Readonly<{
  source: "system" | "stable";
  executable: string;
  execPolicy: string;
  profilePath?: string;
  profileName?: string;
  payloadId: string;
  digest: string;
  leasePath?: string;
  nativePayloads: readonly Readonly<{ id: string; path: string }>[];
}>;
type HostFacts = Readonly<{ id: string; version: string; architecture: string; appArmorEnabled: boolean }>;
type PackageFacts = Readonly<{ status: string; version: string; architecture: string }>;

export class LinuxCompilerLocator {
  constructor(private readonly options: Readonly<{
    manifest: () => Promise<unknown>;
    execPolicy: string;
    host?: () => Promise<HostFacts>;
    installedPackage?: () => Promise<PackageFacts>;
    inspect?: InspectTrustedFile;
    inspectProduct?: InspectTrustedFile;
  }>) {}

  async resolve(stableOnly = false): Promise<LinuxSandboxIdentity> {
    const reasons: string[] = [];
    try {
      const payload = linuxPayloadSchema.parse(await this.options.manifest());
      const host = await (this.options.host ?? readHostFacts)();
      if (host.id !== payload.distribution.id || host.version !== payload.distribution.version ||
          host.architecture !== payload.distribution.architecture || !host.appArmorEnabled) {
        throw new Error("Linux distribution, architecture, or AppArmor is not admitted");
      }
      try {
        if (stableOnly) throw new Error("System component behavior did not pass admission");
        const installed = await (this.options.installedPackage ?? readPackageFacts)();
        if (installed.status !== "install ok installed" || installed.version !== payload.package.version ||
            installed.architecture !== payload.package.architecture) throw new Error("System bubblewrap package is not admitted");
        return await this.verify(payload, "system");
      } catch (cause) { reasons.push(reason(cause)); }
      try {
        const active = activeSchema.parse(JSON.parse((await this.inspect(`${LINUX_COMPONENT_ROOT}/active.json`, 4096)).bytes.toString("utf8")));
        if (active.payloadId !== payload.payloadId || active.binarySha256 !== payload.binary.sha256 ||
            active.profileSha256 !== payload.stable.profile.sha256) throw new Error("Stable component activation does not match the release");
        return await this.verify(payload, "stable");
      } catch (cause) { reasons.push(reason(cause)); }
    } catch (cause) { reasons.push(reason(cause)); }
    throw Object.assign(new Error("App GUI compiler payload is incomplete: no trusted Linux compiler component is ready"), {
      code: "GUI_COMPILER_SANDBOX_UNAVAILABLE",
      component: "linux-compiler-sandbox", repairAction: "install-linux-compiler-component", reasons,
    });
  }

  private get inspect(): InspectTrustedFile { return this.options.inspect ?? inspectTrustedFile; }

  private async verify(payload: LinuxPayload, source: LinuxSandboxIdentity["source"]): Promise<LinuxSandboxIdentity> {
    const stable = stablePaths(payload);
    const executable = source === "system" ? payload.system.path : stable.binary;
    const [binary, profile, execPolicy] = await Promise.all([
      this.inspect(executable, payload.binary.bytes, true),
      source === "stable" ? this.inspect(stable.profile, 64 * 1024) : undefined,
      (this.options.inspectProduct ?? inspectProductFile)(this.options.execPolicy, payload.execPolicy.bytes, true),
    ]);
    verifyArtifact(binary, payload.binary);
    verifyArtifact(execPolicy, payload.execPolicy);
    if (profile) {
      verifyArtifact(profile, payload.stable.profile);
      if (profile.bytes.toString("utf8") !== stableProfile(payload)) throw new Error("Stable AppArmor profile has an unexpected attachment");
    }
    return {
      source, executable, execPolicy: this.options.execPolicy, payloadId: payload.payloadId,
      ...(source === "stable" ? { profilePath: stable.profile, profileName: stable.profileName, leasePath: `${stable.root}/lease.lock` } : {}),
      digest: sha256(Buffer.from(JSON.stringify({ source, payload, binary: binary.identity, profile: profile?.identity, execPolicy: execPolicy.identity }))),
      nativePayloads: [
        { id: "sandbox-linux-x64", path: executable },
        ...(profile ? [{ id: "sandbox-linux-apparmor-profile", path: stable.profile }] : []),
        { id: "sandbox-linux-exec-policy", path: this.options.execPolicy },
      ],
    };
  }
}

async function readHostFacts(): Promise<HostFacts> {
  const path = await realpath("/etc/os-release");
  const release = (await inspectTrustedFile(path, 16 * 1024)).bytes.toString("utf8");
  const fields = new Map<string, string>();
  for (const line of release.split("\n")) {
    const match = /^([A-Z_]+)=(?:"([^"\\]*)"|'([^'\\]*)'|([^\s'"\\]*))$/.exec(line);
    if (!match) continue;
    if (fields.has(match[1]!)) throw new Error("Linux OS release contains duplicate fields");
    fields.set(match[1]!, match[2] ?? match[3] ?? match[4]!);
  }
  return {
    id: fields.get("ID") ?? "", version: fields.get("VERSION_ID") ?? "", architecture: process.arch,
    appArmorEnabled: (await readFile("/sys/module/apparmor/parameters/enabled", "utf8")).trim() === "Y",
  };
}

async function readPackageFacts(): Promise<PackageFacts> {
  await inspectTrustedFile("/usr/bin/dpkg-query", 1024 * 1024, true);
  const result = await execute("/usr/bin/dpkg-query", ["--show", "--showformat=${Status}\n${Version}\n${Architecture}\n", "bubblewrap"], {
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 2000, maxBuffer: 4096, encoding: "utf8",
  });
  const lines = result.stdout.split("\n");
  if (lines.length !== 4 || lines[3] !== "") throw new Error("Unexpected bubblewrap package observation");
  return { status: lines[0]!, version: lines[1]!, architecture: lines[2]! };
}

function reason(cause: unknown) { return (cause instanceof Error ? cause.message : String(cause)).slice(0, 512); }
