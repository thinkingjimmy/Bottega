/**
 * [INPUT]: Live interaction projections and immutable command entries.
 * [OUTPUT]: Loads interaction views only when needed and reserves the composer slot.
 * [POS]: Lightweight composer boundary; transport and answer authority remain in interactions.tsx.
 */
import { lazy, Suspense, type ComponentProps } from "react";
import type { RemoteInteractions as InteractionView } from "./interactions";

const Interactions = lazy(() => import("./interactions").then(module => ({ default: module.RemoteInteractions })));
export function RemoteInteractions(props: ComponentProps<typeof InteractionView>) {
  const { projection, planDecision, children } = props;
  const ownsComposer = Boolean(projection?.userInputs.length || projection?.approvals.some(item => item.purpose === "plan-review"));
  const needed = ownsComposer || projection?.approvals.length || projection?.interactionResults?.length || projection?.phase === "resume-failed";
  if (!needed) return planDecision ?? children;
  return <Suspense fallback={ownsComposer ? null : planDecision ?? children}><Interactions {...props} /></Suspense>;
}
