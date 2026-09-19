/**
 * [INPUT]: Depends on React lazy and the native Sketch dialog's type-only session contract.
 * [OUTPUT]: Provides intent-driven dialog preloading and on-demand editor rendering.
 * [POS]: Keeps editor, geometry, history and Sketch CSS behind the first drawing intent.
 */
import { lazy, type ComponentProps } from "react";
let loaded: typeof import("../dialog") | undefined;
let pending: Promise<typeof import("../dialog")> | undefined;
const load = () => pending ??= import("../dialog").then(module => { loaded = module; return module; });
const Content = lazy(load);
export function preloadSketchDialog() { void load().catch(() => {}); }
export function SketchDialog(props: ComponentProps<typeof Content>) { const Dialog = loaded?.default ?? Content; return <Dialog {...props} />; }
