/**
 * [INPUT]: Depends on openpgp (exact devDependency, tooling only) and the pinned Node release keys in ./release-keys.json (the source commit, and each key's fingerprint with its armored text).
 * [OUTPUT]: Provides RELEASE_KEYS_FILE, loadPinnedReleaseKeys / pinnedReleaseKeys (the pinned keys and fingerprints, each armored key checked against its recorded fingerprint) and openpgpVerifier (verifies a clearsigned SHASUMS256.txt.asc and returns its text and the signer's primary-key fingerprint).
 * [POS]: The real verifier behind fetch-node.mjs's verifier interface; it never fetches keys at verify time.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as openpgp from "openpgp";

/** The keys pinned from nodejs/release-keys, bundled in one file: the source commit and each key's armored text. */
export const RELEASE_KEYS_FILE = fileURLToPath(new URL("./release-keys.json", import.meta.url));

/** Loads every pinned key and refuses one whose primary fingerprint is not the one it is pinned under. */
export async function loadPinnedReleaseKeys(file = RELEASE_KEYS_FILE) {
  const bundle = JSON.parse(await readFile(file, "utf8"));
  const keys = [];
  for (const { fingerprint, armored } of bundle.keys) {
    const key = await openpgp.readKey({ armoredKey: armored });
    if (key.getFingerprint().toUpperCase() !== fingerprint) throw new Error(`Pinned key ${fingerprint} holds ${key.getFingerprint()}.`);
    keys.push(key);
  }
  return keys;
}
export async function pinnedReleaseKeys(file = RELEASE_KEYS_FILE) {
  return (await loadPinnedReleaseKeys(file)).map(key => key.getFingerprint().toUpperCase());
}

/** `allowed` are fingerprints; material comes only from `keyMaterial` (the pinned files unless a test passes its own). */
export function openpgpVerifier({ keyMaterial = () => loadPinnedReleaseKeys() } = {}) {
  return { async verify(armored, allowed) {
    const message = await openpgp.readCleartextMessage({ cleartextMessage: armored });
    const keys = (await keyMaterial()).filter(key => allowed.includes(key.getFingerprint().toUpperCase()));
    const signerIds = message.getSigningKeyIDs().map(id => id.toHex());
    const signer = keys.find(key => key.getKeys().some(part => signerIds.includes(part.getKeyID().toHex())));
    if (!signer) throw new Error(`SHASUMS256.txt.asc is signed by an unpinned key (${signerIds.join(", ") || "none"}).`);
    const { signatures } = await openpgp.verify({ message, verificationKeys: [signer], expectSigned: true })
      .catch(error => { throw new Error(`bad signature: ${error.message}`); });
    await signatures[0].verified.catch(error => { throw new Error(`bad signature: ${error.message}`); });
    return { text: message.getText(), fingerprint: signer.getFingerprint().toUpperCase() };
  } };
}
