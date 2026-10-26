/**
 * [INPUT]: Depends on packaged facts and the real updater factory
 * [OUTPUT]: Provides createSelectedUpdateAdapter with a fail-closed production selection matrix
 * [POS]: The only adapter selection policy; packaged builds use the real updater; unpackaged builds select no adapter
 */

import type { UpdateAdapter } from "./adapter";
import { createElectronUpdateAdapter } from "./electron-adapter";

export function createSelectedUpdateAdapter(input: { isPackaged: boolean; }, factories: { real(): UpdateAdapter; } = { real: createElectronUpdateAdapter }): UpdateAdapter | null {
  if (input.isPackaged) return factories.real();
  return null;
}
