/**
 * [INPUT]: Depends on React and audited Base UI overlay/menu primitives
 * [OUTPUT]: Provides iframe-local Dialog, AlertDialog, Popover, Tooltip, and DropdownMenu source components
 * [POS]: shadcn Base UI snapshot overlay layer with focus and portal authority confined to the App document
 */

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

const popup = "z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 text-slate-950 shadow-xl outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50";
const positioner = "z-50 outline-none";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";
const classes = <State,>(base: string, value: string | ((state: State) => string | undefined) | undefined) =>
  typeof value === "function" ? (state: State) => `${base} ${value(state) ?? ""}` : `${base} ${value ?? ""}`;

export const Dialog = {
  ...DialogPrimitive,
  Popup: (props: React.ComponentProps<typeof DialogPrimitive.Popup>) => <DialogPrimitive.Popup {...props} className={classes(popup, props.className)} />,
  Backdrop: (props: React.ComponentProps<typeof DialogPrimitive.Backdrop>) => <DialogPrimitive.Backdrop {...props} className={classes("fixed inset-0 bg-slate-950/40", props.className)} />,
};

export const AlertDialog = {
  ...AlertDialogPrimitive,
  Popup: (props: React.ComponentProps<typeof AlertDialogPrimitive.Popup>) => <AlertDialogPrimitive.Popup {...props} className={classes(popup, props.className)} />,
  Backdrop: (props: React.ComponentProps<typeof AlertDialogPrimitive.Backdrop>) => <AlertDialogPrimitive.Backdrop {...props} className={classes("fixed inset-0 bg-slate-950/50", props.className)} />,
};

export const Popover = {
  ...PopoverPrimitive,
  Positioner: (props: React.ComponentProps<typeof PopoverPrimitive.Positioner>) => <PopoverPrimitive.Positioner {...props} className={classes(positioner, props.className)} />,
  Popup: (props: React.ComponentProps<typeof PopoverPrimitive.Popup>) => <PopoverPrimitive.Popup {...props} className={classes(popup, props.className)} />,
};

export const Tooltip = {
  ...TooltipPrimitive,
  Trigger: (props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) => <TooltipPrimitive.Trigger {...props} className={classes(focus, props.className)} />,
  Positioner: (props: React.ComponentProps<typeof TooltipPrimitive.Positioner>) => <TooltipPrimitive.Positioner {...props} className={classes(positioner, props.className)} />,
  Popup: (props: React.ComponentProps<typeof TooltipPrimitive.Popup>) => <TooltipPrimitive.Popup {...props} className={classes("z-50 rounded-md bg-slate-950 px-2 py-1 text-xs text-white shadow-lg", props.className)} />,
};

export const DropdownMenu = {
  ...MenuPrimitive,
  Positioner: (props: React.ComponentProps<typeof MenuPrimitive.Positioner>) => <MenuPrimitive.Positioner {...props} className={classes(positioner, props.className)} />,
  Popup: (props: React.ComponentProps<typeof MenuPrimitive.Popup>) => <MenuPrimitive.Popup {...props} className={classes(`${popup} min-w-40 p-1`, props.className)} />,
  Item: (props: React.ComponentProps<typeof MenuPrimitive.Item>) => <MenuPrimitive.Item {...props} className={classes("flex min-h-11 cursor-default items-center rounded-lg px-3 outline-none data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-800", props.className)} />,
};
