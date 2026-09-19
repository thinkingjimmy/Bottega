/**
 * [INPUT]: Depends on the shared UI conversation ResizeObserver registry.
 * [OUTPUT]: Re-exports observeSharedResize and sharedResizeTargetCount for native transcript consumers.
 * [POS]: Native adapter preserving one observer registry across transcript layouts and shared folds.
 */
export { observeSharedResize, sharedResizeTargetCount } from "@ai-chat/ui/components/conversation/resize";
