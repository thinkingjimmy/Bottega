/**
 * [INPUT]: Depends on React, the isolated opaque-reference visual reader and Downloads DTOs.
 * [OUTPUT]: Provides useDownloadVisual and DownloadImage with identity-fenced asynchronous loading and neutral failure slots.
 * [POS]: Downloads presentation adapter; bytes stay local to this mounted detail and disappear under the privacy mask.
 */

import { useEffect, useState } from "react";
import { File, Folder, Package } from "lucide-react";
import type { DownloadEntry, DownloadVisual, DownloadVisualRequest } from "../../../../../../shared/system-dock/ipc";
import { readDownloadVisual } from "../../../../common/bridge";

export function useDownloadVisual(ref: string | null, size: DownloadVisualRequest["size"], masked: boolean) {
  const [result, setResult] = useState<{ key: string; visual: DownloadVisual | null } | null>(null);
  const key = ref && !masked ? `${ref}/${size}` : null;
  useEffect(() => {
    if (!ref || !key) return;
    let current = true;
    void readDownloadVisual({ ref, size }).then((visual) => { if (current) setResult({ key, visual }); });
    return () => { current = false; };
  }, [ref, size, key]);
  return { visual: key && result?.key === key ? result.visual : null, loading: Boolean(key && result?.key !== key) };
}

export function DownloadImage({ entry, visual, loading }: { entry: DownloadEntry; visual: DownloadVisual | null; loading: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (visual && failed !== visual.dataUrl) return <img src={visual.dataUrl} data-visual-kind={visual.kind} alt="" draggable={false} onError={() => setFailed(visual.dataUrl)} />;
  const Glyph = entry.kind === "directory" ? Folder : entry.kind === "package" ? Package : File;
  return loading ? <span className="download-placeholder" aria-hidden="true" /> : <Glyph aria-hidden="true" strokeWidth={1.4} />;
}
