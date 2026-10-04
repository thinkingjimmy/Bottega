/**
 * [INPUT]: Depends on React and audited Base UI Tabs/Accordion primitives
 * [OUTPUT]: Provides keyboard-operable Tabs and Accordion source components
 * [POS]: shadcn Base UI snapshot navigation and disclosure layer
 */

import * as React from "react";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";
const classes = <State,>(base: string, value: string | ((state: State) => string | undefined) | undefined) =>
  typeof value === "function" ? (state: State) => `${base} ${value(state) ?? ""}` : `${base} ${value ?? ""}`;

export const Tabs = {
  ...TabsPrimitive,
  List: (props: React.ComponentProps<typeof TabsPrimitive.List>) => <TabsPrimitive.List {...props} className={classes("flex min-h-11 gap-1 border-b border-slate-200 dark:border-slate-800", props.className)} />,
  Tab: (props: React.ComponentProps<typeof TabsPrimitive.Tab>) => <TabsPrimitive.Tab {...props} className={classes(`min-h-11 rounded-t-lg px-3 font-medium text-slate-600 data-[selected]:text-blue-700 ${focus} dark:text-slate-300 dark:data-[selected]:text-blue-300`, props.className)} />,
  Panel: (props: React.ComponentProps<typeof TabsPrimitive.Panel>) => <TabsPrimitive.Panel {...props} className={classes(`py-4 outline-none ${focus}`, props.className)} />,
};

export const Accordion = {
  ...AccordionPrimitive,
  Item: (props: React.ComponentProps<typeof AccordionPrimitive.Item>) => <AccordionPrimitive.Item {...props} className={classes("border-b border-slate-200 dark:border-slate-800", props.className)} />,
  Trigger: (props: React.ComponentProps<typeof AccordionPrimitive.Trigger>) => <AccordionPrimitive.Trigger {...props} className={classes(`flex min-h-11 w-full items-center justify-between rounded-lg py-2 text-left font-medium ${focus}`, props.className)} />,
  Panel: (props: React.ComponentProps<typeof AccordionPrimitive.Panel>) => <AccordionPrimitive.Panel {...props} className={classes("pb-4 text-slate-600 dark:text-slate-300", props.className)} />,
};
