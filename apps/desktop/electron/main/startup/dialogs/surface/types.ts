/**
 * [INPUT]: Localized main-process text and opaque action/candidate identifiers.
 * [OUTPUT]: DesktopDialogModel and DesktopDialogAction contracts for bundled recovery and quit windows.
 * [POS]: Presentation-only boundary; paths and diagnostics never grant renderer authority.
 */
export type DesktopDialogAction = { id: string; selection?: string };
export type DesktopDialogButton = { id: string; label: string; primary?: boolean; quiet?: boolean; disabled?: boolean; requiresSelection?: boolean };
export type DesktopDialogCandidate = { id: string; path: string; detail: string; isNew?: boolean };
export type DesktopDialogModel = {
  screen: string;
  title: string;
  message: string;
  retry?: string;
  candidates?: readonly DesktopDialogCandidate[];
  selection?: string;
  previous?: { label: string; path: string };
  cancelNew?: string;
  support?: readonly DesktopDialogButton[];
  actions: readonly DesktopDialogButton[];
  defaultAction?: string;
  busy?: boolean;
};
