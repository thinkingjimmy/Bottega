/**
 * [INPUT]: Depends on React and audited Base UI form primitives
 * [OUTPUT]: Provides App-owned Button, Input, Textarea, Label, Field, Checkbox, Switch, RadioGroup, Radio, and Select source components
 * [POS]: shadcn Base UI snapshot form layer copied into generated App source
 */

import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Field as FieldPrimitive } from "@base-ui/react/field";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2";
const control = `min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-950 shadow-sm ${focus} disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50`;
const cn = (...values: Array<string | undefined>) => values.filter(Boolean).join(" ");
const classes = <State,>(base: string, value: string | ((state: State) => string | undefined) | undefined) =>
  typeof value === "function" ? (state: State) => cn(base, value(state)) : cn(base, value);

export function Button(props: React.ComponentProps<typeof ButtonPrimitive>) {
  return <ButtonPrimitive {...props} className={classes(`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-medium text-white hover:bg-blue-700 active:bg-blue-800 ${focus} disabled:cursor-not-allowed disabled:opacity-50`, props.className)} />;
}

export function Input(props: React.ComponentProps<typeof InputPrimitive>) {
  return <InputPrimitive {...props} className={classes(`w-full ${control}`, props.className)} />;
}

export function Textarea(props: React.ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(`w-full resize-y py-2 ${control}`, props.className)} />;
}

export function Label(props: React.ComponentProps<"label">) {
  return <label {...props} className={cn("text-sm font-medium text-slate-800 dark:text-slate-200", props.className)} />;
}

export const Field = FieldPrimitive;

export function Checkbox(props: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root {...props} className={classes(`inline-flex size-11 items-center justify-center rounded-lg border border-slate-300 bg-white ${focus} data-[checked]:border-blue-600 data-[checked]:bg-blue-600 dark:border-slate-700 dark:bg-slate-950`, props.className)}>
      <CheckboxPrimitive.Indicator className="text-lg font-bold text-white">✓</CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch(props: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root {...props} className={classes(`inline-flex h-11 w-14 items-center rounded-full bg-slate-300 p-1 ${focus} data-[checked]:bg-blue-600 dark:bg-slate-700`, props.className)}>
      <SwitchPrimitive.Thumb className="size-6 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none data-[checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

export function RadioGroup(props: React.ComponentProps<typeof RadioGroupPrimitive>) {
  return <RadioGroupPrimitive {...props} className={classes("grid gap-2", props.className)} />;
}

export function Radio(props: React.ComponentProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root {...props} className={classes(`inline-flex size-11 items-center justify-center rounded-full ${focus}`, props.className)}>
      <span className="flex size-5 items-center justify-center rounded-full border border-slate-400">
        <RadioPrimitive.Indicator className="size-3 rounded-full bg-blue-600" />
      </span>
    </RadioPrimitive.Root>
  );
}

export const Select = SelectPrimitive;
