/**
 * [INPUT]: Depends on fixed Dock bundle paths, the running executable, Node child_process/fs/path and macOS codesign/plutil.
 * [OUTPUT]: Provides read-only verification of the Developer ID app, bridge, recovery executable and bundled LaunchAgent contract.
 * [POS]: Replacement admission preflight; it never registers a service or changes Dock preferences.
 */
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DockCapability } from "../../../../shared/system-dock/ipc";
import type { DockPlatform } from "../capability";

const exec = promisify(execFile);
const options = { timeout: 15_000, maxBuffer: 65_536 };
const developerId = "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists";
const fail = () => { throw new Error("DOCK_INSTALLATION_INVALID"); };
async function plist(path: string): Promise<Record<string, unknown>> {
  return JSON.parse((await exec("/usr/bin/plutil", ["-convert", "json", "-o", "-", path], options)).stdout);
}
async function signature(path: string) {
  await exec("/usr/bin/codesign", ["--verify", "--strict", "-R", `=${developerId}`, path], options);
  const { stderr } = await exec("/usr/bin/codesign", ["-dv", "--verbose=4", path], options);
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(stderr)?.[1];
  const identifier = /^Identifier=(.+)$/m.exec(stderr)?.[1];
  if (!team || !identifier || !/flags=.*\(.*runtime.*\)/.test(stderr)) fail();
  return { team, identifier };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function verifyDockInstallation(platform: DockPlatform, appPath: string): Promise<DockCapability> {
  const initial = platform.capability;
  if (!initial.supported || !platform.recoveryAvailable) return initial;
  const { paths, serviceName } = platform;
  try {
    const bundle = resolve(paths.launchAgents, "../../..");
    const info = await plist(join(bundle, "Contents/Info.plist"));
    const id = info.CFBundleIdentifier;
    const executable = info.CFBundleExecutable;
    if (typeof id !== "string" || !/^[A-Za-z0-9.-]+$/.test(id) || typeof executable !== "string" || executable.includes("/")) fail();
    if (await realpath(appPath) !== await realpath(join(bundle, "Contents/MacOS", executable as string))) fail();
    const label = `${id}.dock-recovery`;
    if (serviceName !== `${label}.plist`) fail();
    const config = await plist(join(paths.launchAgents, serviceName!));
    if (config.Label !== label || config.BundleProgram !== "Contents/Resources/system-dock/bin/bottega-dock-recovery"
      || !same(config.ProgramArguments, ["bottega-dock-recovery", label]) || !same(config.MachServices, { [label]: true })
      || !same(config.AssociatedBundleIdentifiers, [id]) || config.RunAtLoad !== true || config.KeepAlive !== false
      || config.ProcessType !== "Background" || "Program" in config) fail();
    const [app, bridge, agent] = await Promise.all([signature(bundle), signature(paths.bridge), signature(paths.agent)]);
    if (app.identifier !== id || bridge.identifier !== "system-dock-bridge" || agent.identifier !== "bottega-dock-recovery"
      || bridge.team !== app.team || agent.team !== app.team) fail();
    return { supported: true, replacement: true, reason: null };
  } catch {
    return { supported: true, replacement: false, reason: "signature-unverified" };
  }
}
