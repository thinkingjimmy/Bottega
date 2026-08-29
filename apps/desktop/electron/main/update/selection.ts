/**
 * [INPUT]: Depends on packaged/E2E/platform facts and real/fake updater factories
 * [OUTPUT]: Provides createSelectedUpdateAdapter with a fail-closed production selection matrix
 * [POS]: The only adapter selection policy; packaged builds always ignore test injection flags
 */

import type { UpdateAdapter } from "./adapter";
import { createElectronUpdateAdapter } from "./electron-adapter";
import { FakeUpdateAdapter } from "./fake-adapter";

export function createSelectedUpdateAdapter(input: {
  isPackaged: boolean;
  e2eEnabled: boolean;
  fakeVersion?: string;
  onFakeInstall?: () => void;
}, factories: {
  real(): UpdateAdapter;
  fake(version?: string, installed?: () => void): UpdateAdapter;
} = {
  real: createElectronUpdateAdapter,
  /* 400ms 让 renderer E2E 稳定观察每一档进度；单测直接构造 fake，
     仍使用它自己的短延迟，不为界面观测窗口付时间成本。 */
  fake: (version, installed) => new FakeUpdateAdapter(version, installed, 400),
}): UpdateAdapter | null {
  if (input.isPackaged) return factories.real();
  if (!input.e2eEnabled) return null;
  return factories.fake(input.fakeVersion, input.onFakeInstall);
}
