/**
 * [INPUT]: Current-window image evidence and the authenticated transcript file reader.
 * [OUTPUT]: Platform ImageTab with shared zoom, filename download, cancellation, retry and inactive release.
 * [POS]: Private cloud media adapter; durable identity must resolve before any read.
 */
import { useMemo } from "react";
import { ImagePanel } from "../image/panel";
import { decodeImageIdentity, resolveImage, type ImageRegion } from "../image/identity";
import { useConversationModel } from "../../conversation/body/model";
import { sidePanelCopy } from "../../../i18n/side-panel";
import type { TranscriptSource } from "../../../platform/contracts";
export function ImageTab({ region, chatId, source, active, locale }: { region: ImageRegion; chatId: string; source: TranscriptSource; active: boolean; locale: string }) {
  const model = useConversationModel(), copy = sidePanelCopy(locale);
  const image = useMemo(() => { const identity = decodeImageIdentity(region); return identity && resolveImage(identity, model.bodies, copy.catalog.image.label); }, [region, model.bodies, copy.catalog.image.label]);
  const port = useMemo(() => image ? { key: region + image.blob.sha256, read: (signal: AbortSignal) => source.file(chatId, image.blob, signal) } : null, [image, source, region, chatId]);
  return <ImagePanel source={port} label={image?.label} active={active} hydrated={model.ready} copy={copy} />;
}
