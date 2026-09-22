/**
 * [INPUT]: Depends on native hostname facts and the shared device-name normalizer.
 * [OUTPUT]: Provides a bounded, `.local`-free platform-native display name with deterministic fallback.
 * [POS]: Login initiation captures this once; registration preserves the approved snapshot.
 */
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { normalizeDeviceName } from "@ai-chat/cloud-protocol";
export async function initialDeviceName(platform = process.platform) {
  let name: string;
  try { name = platform === "darwin" ? (await promisify(execFile)("/usr/sbin/scutil", ["--get", "ComputerName"], { timeout: 2000, maxBuffer: 4096 })).stdout :
    platform === "win32" ? process.env.COMPUTERNAME ?? hostname() : hostname(); }
  catch { name = ""; }
  // The normalizer drops the mDNS `.local` a Linux or Windows hostname carries before it bounds the name,
  // so the badge and the computer switcher never show a suffix nobody chose.
  try { return normalizeDeviceName(name); }
  catch { return platform === "darwin" ? "Mac" : platform === "win32" ? "Windows computer" : "Linux computer"; }
}
