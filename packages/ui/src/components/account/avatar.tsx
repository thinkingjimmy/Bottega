/**
 * [INPUT]: Depends on React, a host-validated image source and the displayed account name.
 * [OUTPUT]: Provides AccountAvatar with stable geometry, private referrers and an image-failure fallback.
 * [POS]: Shared decorative identity primitive; account labels and authentication belong to the host.
 */
import { useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "../../lib/utils";
export function AccountAvatar({ name, src, className }: { name?: string | null; src?: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const initials = name?.split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0]).join("").toLocaleUpperCase();
  return <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium", className)}>
    {src && failed !== src ? <img src={src} alt="" width={80} height={80} decoding="async" referrerPolicy="no-referrer"
      className="size-full object-cover" onError={() => setFailed(src)} /> : initials || <UserRound className="size-4" />}
  </span>;
}
