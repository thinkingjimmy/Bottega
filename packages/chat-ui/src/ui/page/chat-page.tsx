/**
 * [INPUT]: Native or cloud session regions, host chrome, panel state and navigation guards.
 * [OUTPUT]: The single ChatPage tree for header, conversation, composer and retained third column.
 * [POS]: Transport-independent product page; platform adapters supply leaf views and effects, never columns.
 */
import { Suspense, type ReactNode, type ComponentProps } from "react";
import { ChatConversation, type ConversationRegions } from "./conversation";
import { ChatPageFrame } from "./frame";
export type ChatPageViewProps = ComponentProps<typeof ChatPageFrame> & {
  conversation?: { empty: boolean; mounted: boolean; emptyView: ReactNode; fallback: ReactNode; transcript: ReactNode };
  regions?: ConversationRegions;
  status?: ReactNode;
  composer?: ReactNode;
};
export type ChatPageRenderer = (props: ChatPageViewProps) => ReactNode;
export type ChatPageProps = ChatPageViewProps & { session?: (render: ChatPageRenderer) => ReactNode };
export function ChatPage({ session, ...props }: ChatPageProps) {
  return session ? session(renderPage) : <ChatPageView {...props} />;
}
const renderPage: ChatPageRenderer = props => <ChatPageView {...props} />;
/** Embedded surfaces can supply their owning page renderer without creating another page tree. */
export function ChatPageSessionView({ renderPage: render = renderPage, ...props }: ChatPageViewProps & { renderPage?: ChatPageRenderer }) {
  return render(props);
}
function ChatPageView({ conversation, regions, status, composer, children, ...frame }: ChatPageViewProps) {
  const transcript = conversation ? conversation.empty ? conversation.emptyView : conversation.mounted
    ? <Suspense fallback={conversation.fallback}>{conversation.transcript}</Suspense>
    : <div className="min-h-0 flex-1" data-transcript-placeholder /> : children;
  return <ChatPageFrame {...frame}><ChatConversation {...(regions ?? { transcript, status, composer })} /></ChatPageFrame>;
}
