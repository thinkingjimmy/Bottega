/**
 * [INPUT]: Depends on React state, the renderer error projection, localized copy, and the shared AppRecordProjection read model
 * [OUTPUT]: Provides AppSettingsTabProps and useAppSettingsShell — the single busy/error machine the four App settings tabs share
 * [POS]: The seam between AppSettingsPanel's chrome and its four tab bodies; each tab owns its own reads, none of them owns the error banner
 */

import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { AppRecordProjection } from "../../../../shared/apps-ipc";

export type AppSettingsTabProps = Readonly<{
  record: AppRecordProjection;
  busy: boolean;
  /* fail/run 的身份恒定——它们不随 busy 改变引用，页签的取数 effect 才能
     安心把它们写进依赖，而不会因为「有人正忙」重发一遍 IPC。 */
  fail: (cause: unknown, fallback: string) => void;
  run: <T>(operation: () => Promise<T>, fallback: string) => Promise<T | undefined>;
  onClose: () => void;
}>;

/* ============================================================
 * 忙与错归外壳，取数归页签
 *
 * 从前四个页签的四条 IPC 挤在同一个 effect 里：打开设置面就发四条，
 * 任何一次 revision 变动再发四条——而 Radix 的 TabsContent 本就只挂当前
 * 那一个，另外三条读回来的东西没有任何人看。取数因此必须跟着页签走。
 *
 * 留在这一层的只有两样：错误横幅（它在滚动区之外，滚下去看不见的错误
 * 等于没报错）与忙态（同时只有一个页签挂着，两份状态反而更容易说不一致）。
 * ============================================================ */
export function useAppSettingsShell() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* 收的是已译好的那句话，不是目录键：键留在页签自己的 t() 里，静态门禁
     才数得清哪几条文案还活着。 */
  const fail = useCallback(
    (cause: unknown, fallback: string) => setError(errorMessage(cause, fallback)),
    []
  );

  /* 置忙、清错、复位是同一次动作的三件事；写在一处就没有人会忘记 finally。 */
  const run = useCallback(
    async <T,>(operation: () => Promise<T>, fallback: string) => {
      setBusy(true);
      setError("");
      try {
        return await operation();
      } catch (cause) {
        fail(cause, fallback);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fail]
  );

  return { busy, error, fail, run };
}
