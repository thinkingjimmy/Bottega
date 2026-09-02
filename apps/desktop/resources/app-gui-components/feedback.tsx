/**
 * [INPUT]: Depends on React and audited Base UI Progress/Toast primitives
 * [OUTPUT]: Provides Progress and a single Base UI Toast state-machine source surface
 * [POS]: shadcn Base UI snapshot feedback layer; Apps do not install a second notification system
 */

import * as React from "react";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";

const classes = <State,>(base: string, value: string | ((state: State) => string | undefined) | undefined) =>
  typeof value === "function" ? (state: State) => `${base} ${value(state) ?? ""}` : `${base} ${value ?? ""}`;

export function Progress(props: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root {...props} className={classes("grid gap-2", props.className)}>
      <ProgressPrimitive.Track className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <ProgressPrimitive.Indicator className="h-full bg-blue-600 transition-transform duration-200 motion-reduce:transition-none" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export const Toast = {
  ...ToastPrimitive,
  Viewport: (props: React.ComponentProps<typeof ToastPrimitive.Viewport>) => <ToastPrimitive.Viewport {...props} className={classes("fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none", props.className)} />,
  Root: (props: React.ComponentProps<typeof ToastPrimitive.Root>) => <ToastPrimitive.Root {...props} className={classes("rounded-xl border border-slate-200 bg-white p-4 text-slate-950 shadow-xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50", props.className)} />,
};
