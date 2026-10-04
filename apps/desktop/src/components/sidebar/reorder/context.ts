/**
 * [INPUT]: Depends on React context and the merged navigation row union.
 * [OUTPUT]: Provides ChatReorderContext/useChatReorder (the live drag state and lazy row binding a row reads) and chatRowId.
 * [POS]: The eager, dependency-free half of components/sidebar/reorder: rows and lists import this, while the dnd-kit runtime that writes the context loads lazily.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { ChatNavigationRow } from "../cloud/order";
import type { ChatNavigationRowProps } from "./chat-navigation-row";
import type { DropEdge } from "./row-props";

export type ReorderState = { activeId: string | null; overId: string | null; edge: DropEdge | null };

export const ChatReorderContext = createContext<(ReorderState & { Row: ComponentType<ChatNavigationRowProps> }) | null>(null);
/** null outside a mounted runtime (Activity view, or the first frames before the lazy chunk lands): rows render plainly. */
export const useChatReorder = () => useContext(ChatReorderContext);

export const chatRowId = (row: ChatNavigationRow) => row.kind === "native" ? row.chat.id : row.head.chat.id;
