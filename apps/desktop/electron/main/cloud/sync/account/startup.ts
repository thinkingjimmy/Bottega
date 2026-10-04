/**
 * [INPUT]: Depends on the durable sync binding, shared credential storage admission and the installation device identity.
 * [OUTPUT]: Restores the exact Store mode before any business owner can initialize or save data.
 * [POS]: Early account boundary; storage failures stay latched across later Service initialization; enrollment closes without authorizing deletion.
 */
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { CredentialStore } from "../../account/credential-store";
import { SyncBindingStore } from "./binding";
export async function restoreSyncBinding(userData: string, config: CloudBuildConfig, vault: Pick<CredentialStore, "read">, deviceId: string) {
  const binding = new SyncBindingStore(userData, config);
  await binding.initialize();
  try {
    const previous = binding.snapshot();
    if (!previous || previous.phase === "closing") return binding;
    let credentials;
    try { credentials = await vault.read(); }
    catch { binding.restrictEnrollment(true); return binding; }
    binding.restrictEnrollment(credentials.signOutRequested || !credentials.session ||
      credentials.session.userId !== previous.userId || deviceId !== previous.deviceId);
    return binding;
  } catch (error) { await binding.close(); throw error; }
}
