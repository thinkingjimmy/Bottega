/**
 * [INPUT]: Depends on the selected Linux component and the fixed compiler's kernel AppArmor label
 * [OUTPUT]: Validates actual named-profile attachment without inventing system profile artifacts
 * [POS]: Shared Linux probe contract; stable profiles remain bound to their exact release identity
 */

import type { LinuxSandboxIdentity } from "./locator";

export function admittedLinuxProfile(component: Pick<LinuxSandboxIdentity, "source" | "profileName">, label: unknown): label is string {
  if (typeof label !== "string") return false;
  if (component.source === "stable") {
    return !!component.profileName && [`${component.profileName} (unconfined)`, `${component.profileName} (enforce)`].includes(label);
  }
  // The kernel observation and negative probes are authoritative for host-managed policy.
  return ![...label].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
    /^.{1,1024} \((?:enforce|unconfined)\)$/.test(label);
}
