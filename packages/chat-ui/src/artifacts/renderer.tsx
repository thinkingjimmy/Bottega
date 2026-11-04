/**
 * [INPUT]: Streamdown custom fences and strict portable artifact schemas.
 * [OUTPUT]: A path-free artifact/frozen-instruction renderers and shared message renderer boundary with persistent expanded loading chrome; malformed and unfinished fences never become code blocks.
 * [POS]: Artifact fence registry shared by desktop and cloud transcripts.
 */
import { DESIGN_REFERENCE_LANGUAGE } from "@bottega/contracts/model/artifacts/design-message";
import { lazy, Suspense, type ReactNode } from "react";
import { MessageRendererProvider } from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import type { CustomRenderer, CustomRendererProps } from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { ArtifactLoading } from "./presentation/header";
const Card = lazy(() => import("./card").then(module => ({ default: module.ArtifactCard })));
const CodeBlock = lazy(() => import("./card").then(module => ({ default: module.ArtifactCodeBlock })));
function Loading() { return <div aria-busy="true" style={{ minHeight: 200 }} />; }
export function ArtifactPreview(props: { fence: ArtifactFence; expanded?: boolean }) { return <Suspense fallback={props.expanded ? <ArtifactLoading title={props.fence.title} /> : <Loading />}><Card {...props} /></Suspense>; }
function ArtifactFenceRenderer(props: CustomRendererProps) { return <Suspense fallback={<Loading />}><CodeBlock {...props} /></Suspense>; }
export const ARTIFACT_FENCE_RENDERER: CustomRenderer = { language: "bottega-artifact", component: ArtifactFenceRenderer };
const Reference = lazy(() => import("./reference/view").then(module => ({ default: module.SentDesignReference })));
function ReferenceRenderer(props: CustomRendererProps) { return <Suspense fallback={<Loading />}><Reference {...props} /></Suspense>; }
const renderers: CustomRenderer[] = [ARTIFACT_FENCE_RENDERER, { language: DESIGN_REFERENCE_LANGUAGE, component: ReferenceRenderer }];
export function ArtifactMessageRenderers({ children }: { children: ReactNode }) {
  return <MessageRendererProvider value={renderers}>{children}</MessageRendererProvider>;
}
