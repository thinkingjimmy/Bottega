"use client";

/**
 * [INPUT]: Re-exports the app-dialog folder's shell, parts, choice, step, and confirmation modules
 * [OUTPUT]: The public surface of the product dialog spec: AppDialogContent, AppDialogBody, AppDialogHeader, AppDialogFooter, AppDialogCancel, AppDialogField, AppDialogAlert, DialogChoice, DialogChoiceGroup, StepDialogContent, ConfirmationDialog and their prop types
 * [POS]: packages/ui/src/components/ui/overlays/app-dialog; Barrel for the one product dialog shell (findings.md D1–D15)
 */

export { AppDialogBody, AppDialogContent, useAppDialogSize } from "./shell";
export type { AppDialogSize } from "./shell";
export {
  AppDialogAlert,
  AppDialogCancel,
  AppDialogField,
  AppDialogFooter,
  AppDialogHeader,
} from "./parts";
export { DialogChoice, DialogChoiceGroup } from "./choice";
export type { DialogChoiceProps } from "./choice";
export { StepDialogContent } from "./step";
export type { StepDialogAccount, StepDialogProgress } from "./step";
export { ConfirmationDialog } from "./confirmation";
export type { ConfirmationDialogProps } from "./confirmation";
