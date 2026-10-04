/**
 * [INPUT]: Depends on the public Provider descriptor schema and checkProviderPackage (@bottega/contracts), the built-in Provider descriptors, Node fs, and manifest-adapter's containment check.
 * [OUTPUT]: Provides ProviderPackageAdmission and admitProviderPackage: reads a Provider package's descriptor file strictly, runs the public structural check, then the host's policy (reserved built-in ids and commands, protected and built-in state roots, reserved environment names, no keychain services yet, native ACP launches only); a bundled built-in package instead must carry exactly the descriptor this host compiled in for its id.
 * [POS]: Called by host-package admission (manifest.ts) for a manifest that declares a Provider; package code is never run here, only its declared files are read.
 */
import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { checkProviderPackage, PROVIDER_DESCRIPTOR_FILE, type ProviderPackageRefusal } from "@bottega/contracts/host/provider-package";
import type { HostPackageManifest } from "@bottega/contracts/host/manifest";
import { providerDescriptorSchema, type ProviderDescriptor } from "@bottega/contracts/model/provider";
import { BUILTIN_PROVIDER_DESCRIPTORS } from "../../../../shared/providers/builtin";
import { containedExisting } from "../manifest-adapter";

export type ProviderPackageAdmission =
  | { ok: true; descriptor: ProviderDescriptor }
  | { ok: false; refusal: ProviderPackageRefusal | "descriptor-unreadable" | "descriptor-invalid" | "provider-id-reserved" | "command-reserved"
      | "sensitive-root-protected" | "env-reserved" | "keychain-unsupported" | "bundled-descriptor-drift" | "launch-kind-unsupported"; detail: string };

const DESCRIPTOR_BYTES = 64 * 1024;
const BUILTINS = BUILTIN_PROVIDER_DESCRIPTORS;
/* A Provider's own roots are readable by its own process, so a package may never claim credentials or state that belong to someone
   else: the built-in Providers' roots, and the well-known credential roots of other tools. */
const PROTECTED_ROOTS = [...BUILTINS.flatMap(descriptor => descriptor.sensitiveRoots.paths), "~/.ssh", "~/.gnupg", "~/.aws", "~/.azure",
  "~/.kube", "~/.docker", "~/.config/gcloud", "~/.config/git", "~/.netrc", "~/.npmrc", "~/.pypirc", "~/.git-credentials"];
/* Names the host sets for its own processes, and the families other Providers read their credentials and homes from. */
const HOST_ENV = new Set(["HOME", "PATH", "SHELL", "USER", "LOGNAME", "TMPDIR", "TERM", "LANG",
  ...BUILTINS.flatMap(descriptor => [...descriptor.runtime.env.allow, ...descriptor.sensitiveRoots.envOverrides])]);
const HOST_ENV_PREFIXES = ["NODE_", "ELECTRON_", "DYLD_", "LD_", "XDG_", "BOTTEGA_", "AI_CHAT_", "ANTHROPIC_", "CLAUDE_", "OPENAI_",
  "CODEX_", "KIMI_", "MOONSHOT_", "OPENCODE_"];

const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const envReserved = (name: string) => HOST_ENV.has(name) || HOST_ENV_PREFIXES.some(prefix => name.startsWith(prefix));

/** `bundled`: a built-in package that ships inside the app (d3). The host policy exists to keep other packages off the built-ins' ids,
    commands, roots and environment, so it cannot apply to a built-in itself; instead its descriptor must equal the one compiled in. */
export async function admitProviderPackage(packageRoot: string, manifest: HostPackageManifest, options: { bundled?: boolean } = {}): Promise<ProviderPackageAdmission> {
  let raw: unknown;
  try {
    const path = await containedExisting(packageRoot, PROVIDER_DESCRIPTOR_FILE, "file");
    if ((await stat(path)).size > DESCRIPTOR_BYTES) return { ok: false, refusal: "descriptor-unreadable", detail: `larger than ${DESCRIPTOR_BYTES} bytes` };
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    return { ok: false, refusal: "descriptor-unreadable", detail: (cause as Error).message.slice(0, 300) };
  }
  const parsed = providerDescriptorSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, refusal: "descriptor-invalid", detail: parsed.error.issues.map(issue => `${issue.path.join(".") || "descriptor"}: ${issue.message}`).join("; ").slice(0, 1_000) };
  }
  const descriptor = parsed.data;
  const structural = checkProviderPackage(manifest, descriptor);
  if (!structural.ok) return structural;
  if (options.bundled) {
    const builtin = BUILTINS.find(candidate => candidate.providerId === descriptor.providerId);
    return builtin && isDeepStrictEqual(descriptor, builtin) ? { ok: true, descriptor }
      : { ok: false, refusal: "bundled-descriptor-drift", detail: `${descriptor.providerId} is not this host's built-in descriptor` };
  }
  if (BUILTINS.some(builtin => builtin.providerId === descriptor.providerId)) return { ok: false, refusal: "provider-id-reserved", detail: descriptor.providerId };
  const command = descriptor.runtime.discovery.commands.find(value => BUILTINS.some(builtin => builtin.runtime.discovery.commands.includes(value)));
  if (command !== undefined) return { ok: false, refusal: "command-reserved", detail: command };
  const root = descriptor.sensitiveRoots.paths.find(path => PROTECTED_ROOTS.some(protectedRoot => overlaps(path, protectedRoot)));
  if (root !== undefined) return { ok: false, refusal: "sensitive-root-protected", detail: root };
  const env = [...descriptor.runtime.env.allow, ...descriptor.runtime.env.processStart, ...descriptor.sensitiveRoots.envOverrides].find(envReserved);
  if (env !== undefined) return { ok: false, refusal: "env-reserved", detail: env };
  if (descriptor.sensitiveRoots.keychainServices.length) return { ok: false, refusal: "keychain-unsupported", detail: descriptor.sensitiveRoots.keychainServices.join(", ") };
  /* An adapter is package JavaScript on the bundled Node, which has no isolation boundary this period: a package runs its own CLI only. */
  if (descriptor.runtime.launch.kind !== "acp-stdio-native") return { ok: false, refusal: "launch-kind-unsupported", detail: descriptor.runtime.launch.kind };
  return { ok: true, descriptor };
}
