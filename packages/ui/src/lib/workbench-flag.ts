/**
 * [INPUT]: Depends on the build-time define `__BOTTEGA_WORKBENCH_UI__` (set from BOTTEGA_WORKBENCH_UI=1 by the desktop renderer and Cloud Web builds).
 * [OUTPUT]: Provides workbenchUiEnabled, the one switch for workbench entry points whose backends are not ready yet.
 * [POS]: Off by default; hosts that do not define it (tests, other bundles) read false.
 */
declare const __BOTTEGA_WORKBENCH_UI__: boolean | undefined;

export const workbenchUiEnabled = typeof __BOTTEGA_WORKBENCH_UI__ !== "undefined" && __BOTTEGA_WORKBENCH_UI__ === true;
