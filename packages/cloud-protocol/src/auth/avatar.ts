/**
 * [INPUT]: Depends on URL parsing for Google profile image origins.
 * [OUTPUT]: Provides an exact HTTPS avatar allowlist and bounded image download without credentials or redirects.
 * [POS]: Public profile image boundary shared by the server projection and desktop cache.
 */
export const GOOGLE_AVATAR_ORIGINS = [3, 4, 5, 6].map(index => `https://lh${index}.googleusercontent.com`);
export const MAX_AVATAR_BYTES = 262_144;
export function googleAvatarUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2048) return null;
  try {
    const url = new URL(input);
    return GOOGLE_AVATAR_ORIGINS.includes(url.origin) && !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}
export async function downloadGoogleAvatar(url: string, signal: AbortSignal, request: typeof fetch = fetch) {
  const safe = googleAvatarUrl(url); if (!safe) throw new Error("avatar-origin-invalid");
  const response = await request(safe, { signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
  const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!response.ok || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime ?? "") || !response.body) throw new Error("avatar-response-invalid");
  if (Number(response.headers.get("content-length")) > MAX_AVATAR_BYTES) { await response.body.cancel(); throw new Error("avatar-too-large"); }
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength; if (size > MAX_AVATAR_BYTES) throw new Error("avatar-too-large");
      parts.push(result.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  signal.throwIfAborted(); if (!size) throw new Error("avatar-empty");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return { mime: mime!, bytes };
}
