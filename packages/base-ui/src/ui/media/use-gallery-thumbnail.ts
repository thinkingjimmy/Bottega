/**
 * [INPUT]: Depends on React effect/state, shared GalleryMediaSourceRef and an injected private thumbnail loader
 * [OUTPUT]: Provides use of GalleryThumbnail with predictable PreviewBudget, unified stable sourceRef, CACHE_PENDING, withdrawal, retry signal, cancellation, error projection and 128MiB preview budget
 * [POS]: Shared Base presentation in ui/media.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  galleryOccurrenceKey,
  type GalleryMediaSourceRef,
  type GalleryThumbnailResult,
} from "@ai-chat/base-ui/attachments/gallery-media-ipc";

export type GalleryThumbnailPreview = Extract<
  GalleryThumbnailResult,
  { ok: true }
>["value"];

export type GalleryThumbnailRequest =
  | "idle"
  | "loading"
  | "cache-pending"
  | "ready"
  | { error: string; retryable: boolean };

export type GalleryThumbnailSnapshot = {
  preview: GalleryThumbnailPreview | null;
  request: GalleryThumbnailRequest;
};

type KeyedSnapshot = GalleryThumbnailSnapshot & { key: string };

const PREVIEW_BUDGET = 128 * 1024 * 1024;

export class GalleryThumbnailPreviewBudget {
  private readonly retained = new Map<
    object,
    { bytes: number; evict(): void }
  >();
  private bytes = 0;

  constructor(private readonly maxBytes = PREVIEW_BUDGET) {}

  get size() {
    return this.retained.size;
  }

  retain(owner: object, dataUrl: string, evict: () => void) {
    this.release(owner);
    const bytes = Math.ceil(dataUrl.length * 0.75);
    this.retained.set(owner, { bytes, evict });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes && this.retained.size > 1) {
      const oldest = this.retained.entries().next().value as
        | [object, { bytes: number; evict(): void }]
        | undefined;
      if (!oldest) break;
      this.retained.delete(oldest[0]);
      this.bytes -= oldest[1].bytes;
      oldest[1].evict();
    }
  }

  release(owner: object) {
    const current = this.retained.get(owner);
    if (!current) return;
    this.retained.delete(owner);
    this.bytes -= current.bytes;
  }
}

const previewBudget = new GalleryThumbnailPreviewBudget();

export function useGalleryThumbnail({
  sourceRef,
  maxEdge,
  load,
  retrySignal = 0,
  onSourceGone,
}: {
  sourceRef: GalleryMediaSourceRef;
  maxEdge: number;
  load(input: { sourceRef: GalleryMediaSourceRef; maxEdge: number }, signal: AbortSignal): Promise<GalleryThumbnailResult & { release?: () => void }>;
  retrySignal?: number;
  onSourceGone?: () => void;
}): GalleryThumbnailSnapshot {
  const [snapshot, setSnapshot] = useState<KeyedSnapshot>({
    key: "",
    preview: null,
    request: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const [owner] = useState<object>(() => ({}));
  const sourceGoneRef = useRef(onSourceGone);
  const sourceIdentity = `${galleryOccurrenceKey(sourceRef)}:${
    sourceRef.kind === "attachment" ? sourceRef.sourceRevision : ""
  }`;
  const stableRef = useMemo(
    () => ({ ...sourceRef }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Occurrence and revision are the complete immutable media identity.
    [sourceIdentity]
  );
  const identity = sourceIdentity;
  const requestKey = `${identity}:${maxEdge}:${retrySignal}`;

  useEffect(() => {
    sourceGoneRef.current = onSourceGone;
  }, [onSourceGone]);
  useEffect(() => () => previewBudget.release(owner), [owner]);

  useEffect(() => {
    const controller = new AbortController();
    let release: (() => void) | undefined;

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    previewBudget.release(owner);
    void load({ sourceRef: stableRef, maxEdge }, controller.signal)
      .then((result) => {
        if (!active) { result.release?.(); return; }
        release = result.release;
        if (result.ok) {
          const preview = result.value;
          previewBudget.retain(owner, preview.dataUrl, () => {
            release?.(); release = undefined;
            setSnapshot((current) =>
              current.preview?.dataUrl === preview.dataUrl
                ? {
                    key: requestKey,
                    preview: null,
                    request: { error: "PREVIEW_EVICTED", retryable: true },
                  }
                : current
            );
          });
          setSnapshot({ key: requestKey, preview, request: "ready" });
          return;
        }
        if (result.error.code === "CACHE_PENDING") {
          setSnapshot((current) => ({
            key: requestKey,
            preview: current.key === requestKey ? current.preview : null,
            request: "cache-pending",
          }));
          retryTimer = setTimeout(() => {
            if (active) setAttempt((value) => value + 1);
          }, Math.min(2000, 150 * 2 ** attempt));
          return;
        }
        if (result.error.code === "SOURCE_GONE") sourceGoneRef.current?.();
        setSnapshot((current) => ({
          key: requestKey,
          preview: current.key === requestKey ? current.preview : null,
          request: {
            error: result.error.code,
            retryable: result.error.retryable,
          },
        }));
      })
      .catch(() => {
        if (!active) return;
        setSnapshot((current) => ({
          key: requestKey,
          preview: current.key === requestKey ? current.preview : null,
          request: { error: "IO_ERROR", retryable: true },
        }));
      });
    return () => {
      active = false; controller.abort(); release?.(); previewBudget.release(owner);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [attempt, load, maxEdge, owner, requestKey, stableRef]);

  return snapshot.key === requestKey
    ? snapshot
    : { preview: null, request: "loading" };
}
