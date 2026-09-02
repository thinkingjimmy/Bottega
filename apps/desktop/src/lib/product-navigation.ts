/**
 * [INPUT]: Depends on typed ProductDestination, Apps navigation IPC, and a renderer navigate callback
 * [OUTPUT]: Provides the renderer destination adapter; App Use routes advance only after a completed main-owned residence receipt
 * [POS]: Renderer navigation boundary; product components choose a destination while this module performs main-owned App intents and encodes routes
 */

import {
  productDestinationRoute,
  type ProductDestination,
} from "../../shared/placement/facts";
import {
  openAppEditor,
  openAppEditorChat,
  openAppUseChat,
} from "./apps-client";

export type NavigateProduct = (
  route: string,
  options?: { replace?: boolean }
) => void;

export { productDestinationRoute };

export async function openProductDestination(
  destination: ProductDestination,
  navigate: NavigateProduct,
  options?: { replace?: boolean }
) {
  let canonical = destination;
  if (destination.kind === "app-use-chat") {
    const receipt = await openAppUseChat({
      appId: destination.appId,
      chatId: destination.chatId,
      incarnationId: destination.incarnationId,
      requestId: crypto.randomUUID(),
    });
    if (receipt.status === "precommit-rejected") {
      throw new Error(receipt.reason);
    }
    if (receipt.status !== "completed") {
      return receipt.target;
    }
    canonical = receipt.target;
  } else if (destination.kind === "app-editor-draft") {
    canonical = await openAppEditor({
      appId: destination.appId,
      requestId: crypto.randomUUID(),
      mode: destination.kind === "app-editor-draft" ? "new" : "resume",
    });
  } else if (destination.kind === "app-editor-chat") {
    canonical = await openAppEditorChat({
      appId: destination.appId,
      projectId: destination.projectId,
      chatId: destination.chatId,
      incarnationId: destination.incarnationId,
      requestId: crypto.randomUUID(),
    });
  }
  navigate(productDestinationRoute(canonical), options);
  return canonical;
}
