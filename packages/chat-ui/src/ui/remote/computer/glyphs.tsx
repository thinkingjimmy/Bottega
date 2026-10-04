/**
 * [INPUT]: Depends on the protocol's device platform enum and lucide's generic screen icons.
 * [OUTPUT]: Provides PlatformGlyph — the computer chip's face: Apple for macOS, the Windows mark, a monitor for Linux, a globe for browsers, a crossed monitor for none.
 * [POS]: The computer surface's iconography, beside selectors.tsx and the read-only card; names live in tooltips and menu rows, never on the chip.
 */
import type { SVGProps } from "react";
import { Globe, Monitor, MonitorOff } from "lucide-react";
import type { RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
export type PlatformGlyphKind = RemoteTarget["platform"] | "none";
function AppleMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M16.37 12.7c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.97.9-3.77 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 3 .72 1.24-.02 2.02-1.12 2.78-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.4-3.69zM14.1 5.95c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.51 2.69-1.27z" />
  </svg>;
}
function WindowsMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M3 5.5 10.5 4.4v7.2H3zM11.6 4.2 21 3v8.6h-9.4zM3 12.4h7.5v7.2L3 18.5zM11.6 12.4H21V21l-9.4-1.3z" />
  </svg>;
}
export function PlatformGlyph({ kind, className }: { kind: PlatformGlyphKind; className?: string }) {
  if (kind === "macos") return <AppleMark className={className} />;
  if (kind === "windows") return <WindowsMark className={className} />;
  if (kind === "browser") return <Globe className={className} aria-hidden="true" />;
  if (kind === "none") return <MonitorOff className={className} aria-hidden="true" />;
  return <Monitor className={className} aria-hidden="true" />;
}
