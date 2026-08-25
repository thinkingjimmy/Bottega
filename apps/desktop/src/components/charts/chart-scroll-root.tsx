/**
 * [INPUT]: Depends on React context/layout effect with Conversation's stick-to-bottom scrollRef
 * [OUTPUT]: Provides ChartScrollRootContext/Provider with ChartConversationBoundary
 * [POS]: The IO root of components/charts is inserted into the boundary; Base does not use this context
 */

import {
  createContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useStickToBottomContext } from "@ai-chat/ui/components/ai-elements/conversation";

export const ChartScrollRootContext = createContext<Element | null>(null);
export const ChartScrollRootProvider = ChartScrollRootContext.Provider;

export function ChartConversationBoundary({ children }: { children: ReactNode }) {
  const { scrollRef } = useStickToBottomContext();
  const [root, setRoot] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setRoot(scrollRef.current);
  }, [scrollRef]);
  return (
    <ChartScrollRootProvider value={root}>
      {children}
    </ChartScrollRootProvider>
  );
}
