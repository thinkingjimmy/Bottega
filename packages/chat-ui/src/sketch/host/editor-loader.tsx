/**
 * [INPUT]: Depends on React lazy loading and the dynamically imported Sketch editor content.
 * [OUTPUT]: Provides intent-driven editor preloading and synchronous rendering once its module is ready.
 * [POS]: Shared loading resource for the composer menu and persistent Sketch dialog.
 */
import { lazy } from "react";
import type { SketchContentProps } from "../content";

let module: typeof import("../content") | undefined;
let pending: Promise<typeof import("../content")> | undefined;
const load = () =>
  (pending ??= import("../content").then((loaded) => {
    module = loaded;
    return loaded;
  }));
const LazyContent = lazy(load);

export function preloadSketchEditor() {
  // Opening the menu is speculative; the dialog boundary owns any load error.
  void load().catch(() => {});
}

export function SketchContent(props: SketchContentProps) {
  // A preloaded module should render immediately without a one-frame suspension.
  const Content = module?.default ?? LazyContent;
  return <Content {...props} />;
}
