/**
 * [INPUT]: Depends on React/router, App i18n, error normalization, product navigation, and an exact App Editor chat destination
 * [OUTPUT]: Provides AppEditorRouteGate, which withholds interactive chat children until main approves and redirects rejected targets to Apps with localized evidence
 * [POS]: ChatRoute security gate for hidden, unavailable, non-editable, archived, or stale App Editor chat deep links
 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
import { openProductDestination } from "@/lib/product-navigation";
import type { AppEditorDestination } from "../../shared/placement/facts";

type ExactEditorDestination = Extract<
  AppEditorDestination,
  { kind: "app-editor-chat" }
>;

type GateState = Readonly<{
  key: string;
  status: "pending" | "approved" | "rejected";
  error?: string;
}>;

const destinationKey = (destination: ExactEditorDestination) =>
  [
    destination.appId,
    destination.projectId,
    destination.chatId,
    destination.incarnationId,
  ].join(":");

export function AppEditorRouteGate({
  children,
  destination,
}: {
  children: ReactNode;
  destination: ExactEditorDestination;
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { appId, chatId, incarnationId, projectId } = destination;
  const key = destinationKey(destination);
  const [gate, setGate] = useState<GateState>({ key, status: "pending" });

  useEffect(() => {
    let current = true;
    void openProductDestination(
      {
        kind: "app-editor-chat",
        appId,
        projectId,
        chatId,
        incarnationId,
      },
      navigate,
      { replace: true }
    )
      .then(() => {
        if (current) setGate({ key, status: "approved" });
      })
      .catch((cause) => {
        if (!current) return;
        const message = t("apps.usePanel.editorOpenFailed", {
          message: errorMessage(
            cause,
            t("apps.usePanel.editorOpenUnavailable")
          ),
        });
        setGate({ key, status: "rejected", error: message });
        navigate("/apps", {
          replace: true,
          state: { appNavigationError: message },
        });
      });
    return () => {
      current = false;
    };
  }, [
    appId,
    chatId,
    incarnationId,
    key,
    navigate,
    projectId,
    t,
  ]);

  if (gate.key !== key || gate.status === "pending") {
    return (
      <div
        className="h-full"
        role="status"
        aria-label={t("apps.usePanel.preparing")}
      />
    );
  }
  if (gate.status === "rejected") {
    return <p role="alert">{gate.error}</p>;
  }
  return children;
}
