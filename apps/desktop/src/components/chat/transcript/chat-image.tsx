/**
 * [INPUT]: Depends on ImageShimmer, share useGalleryThumbnail, Gallery sourceRef and conversation Open the intent of the image
 * [OUTPUT]: Provides ImageBlock; When completed and authenticated, the third loop is opened with a 44px+ focusable trigger, which does not receive local paths
 * [POS]: The image filter for chat/transcript, separated from the chat-turn to separate the Markdown dependencies; Consumed exclusively by the TurnParts image group
 */

import { ImageShimmer } from "@ai-chat/ui/components/ai-elements/image-shimmer";
import type { DraftToolPart } from "../../../../shared/chat-turn-reducer";
import type { GallerySourceRef } from "../../../../shared/gallery-media-ipc";
import { useGalleryThumbnail } from "@/lib/gallery/media/use-gallery-thumbnail";
import type { ConversationImageSource } from "../runtime/chat-session-model";

// ─── 缩略图：挂载即向主进程要降采样结果，原图体量隔离在 main ───
// sourceRef 由宿主逐 render 重建，必须按字段值稳定；CACHE_PENDING（刚完成、复制在途）退避重试而非判死。

function Thumbnail({
  sourceRef,
  title,
  onOpen,
}: {
  sourceRef: GallerySourceRef;
  title: string;
  onOpen?: (source: ConversationImageSource) => void;
}) {
  const { preview, request } = useGalleryThumbnail({
    sourceRef,
    maxEdge: 640,
  });
  if (typeof request === "object" && !preview)
    return (
      <div className="my-1 rounded-md bg-muted/50 p-3 text-muted-foreground text-xs">
        无法预览图片
      </div>
    );
  // sourceRef 为 null 是 incarnation 水合中的过渡态，等它到位而不是提前判死
  if (!preview)
    return <ImageShimmer className="my-1" label="正在读取图片" />;
  const image = (
    <img
      alt="Generated"
      className="my-1 max-h-64 max-w-xs rounded-md border object-contain"
      draggable={false}
      height={preview.height}
      src={preview.dataUrl}
      width={preview.width}
    />
  );
  if (!onOpen) return image;
  return (
    <button
      aria-label={`在第三栏打开图片：${title || "Image"}`}
      className="block min-h-11 min-w-11 cursor-pointer touch-manipulation rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={() =>
        onOpen({ kind: "generated", sourceRef, title: title || "Image" })
      }
      type="button"
    >
      {image}
    </button>
  );
}

/**
 * 生图只有两态：running 是尚无画面的等待，其余按 occurrence sourceRef 取图。
 * renderer 不接收 detail 路径；main 以 chat/incarnation/seq/itemId 重新授权。
 */
export function ImageBlock({
  part,
  sourceRef = null,
  onOpen,
}: {
  part: DraftToolPart;
  sourceRef?: GallerySourceRef | null;
  onOpen?: (source: ConversationImageSource) => void;
}) {
  return (
    <div className="w-full min-w-0">
      {part.status === "running" ? (
        <ImageShimmer className="my-1" />
      ) : part.status === "failed" ? (
        <div className="my-1 rounded-md bg-muted/50 p-3 text-muted-foreground text-xs">
          无法预览图片
        </div>
      ) : !sourceRef ? (
        <ImageShimmer className="my-1" label="正在读取图片" />
      ) : (
        <Thumbnail onOpen={onOpen} sourceRef={sourceRef} title={part.title} />
      )}
    </div>
  );
}
