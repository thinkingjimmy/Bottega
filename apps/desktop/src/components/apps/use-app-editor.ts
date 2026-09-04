/**
 * [INPUT]: Depends on the App Editor destination IPC, product navigation routing, window-surface role, toast, the renderer error projection, and localized copy
 * [OUTPUT]: Provides useAppEditor — the one "resume this App's edit session" command shared by the Web and Base detail surfaces
 * [POS]: Command leaf of components/apps; main owns the destination, the renderer only decides whether this window is the one that should follow it
 */

import { useNavigate } from "react-router";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { openAppEditor } from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";
import { productDestinationRoute } from "@/lib/product-navigation";
import { windowContext } from "@/lib/window-surfaces-client";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* 两个详情体从前各写一份同样的十行：同一条 IPC、同一句 requestId、同一个
   「独立窗口不跟着跳」的判断，以及同一句失败提示。两份都对，但没有一份
   说了算——任何一次 Editor 协议的改动都得靠人记得改满两处。 */
export function useAppEditor(appId: string) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  return async () => {
    try {
      const destination = await openAppEditor({
        appId,
        requestId: crypto.randomUUID(),
        mode: "resume",
      });
      /* App 窗口是一块被钉死的面：它不该把自己导航去别处，否则那扇窗
         就不再是它声称的那个 App。 */
      if (windowContext().role !== "app-window") {
        navigate(productDestinationRoute(destination));
      }
    } catch (cause) {
      toast.error(t("apps.baseDetail.edit"), { description: errorMessage(cause) });
    }
  };
}
