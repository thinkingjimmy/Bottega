/**
 * [INPUT]: Depends on host-controlled open state and the deferred SaveAsAppDialog contract.
 * [OUTPUT]: Provides SaveAsAppDialog only when requested, without importing its runtime during first paint.
 * [POS]: Lazy App-save boundary shared by Base headers and side-panel menus.
 */
import { lazy, Suspense, type ComponentProps } from "react";
const Content = lazy(() => import("./save-as-app-dialog").then(module => ({ default: module.SaveAsAppDialog })));
export function SaveAsAppDialog(props: ComponentProps<typeof Content>) {
  return props.open ? <Suspense fallback={null}><Content {...props} /></Suspense> : null;
}
