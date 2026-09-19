/**
 * [INPUT]: Depends on React lazy/Suspense and the lazily imported chat-reorder-runtime.
 * [OUTPUT]: Provides ChatReorderList, the eager entry Project sublists and the root Chats group wrap their rows in.
 * [POS]: Bundle boundary of components/sidebar/reorder: the drag orchestration and drop policy stay out of the eager renderer chunk; until the runtime chunk resolves the rows render as plain, non-draggable rows.
 */
import { Suspense, lazy, type ComponentProps } from "react";

/* 侧栏首屏不为拖拽买单：DndContext 接线、落点追踪、药丸、点击守卫与键算法只在这块惰性 chunk 里
   。Suspense 的 fallback 就是行本身——chunk 落地前
   列表已可导航，落地后同一批行进入 DndContext。 */
const ChatReorderRuntime = lazy(() => import("./chat-reorder-runtime").then((module) => ({ default: module.ChatReorderRuntime })));

export function ChatReorderList(props: ComponentProps<typeof ChatReorderRuntime>) {
  return (
    <Suspense fallback={props.children}>
      <ChatReorderRuntime {...props} />
    </Suspense>
  );
}
