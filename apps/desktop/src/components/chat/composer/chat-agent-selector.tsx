/**
 * [INPUT]: Depends on shared BackendInfo, renderer agent-backends, Chat composer i18n, end-to-end testing mode and ui/select
 * [OUTPUT]: Provides localized ChatAgentSelector; selectable and read-only identities expose the current/checking Agent state without duplicating visible horizontal space
 * [POS]: Compact Agent identity control beside the model selector; read-only mode preserves identity without duplicating status chrome
 */

import { useEffect, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@ai-chat/ui/components/ui/select";
import type {
  AgentBackendId,
  BackendInfo,
} from "../../../../shared/agent-ipc";
import {
  AgentBackendIcon,
  agentSelectionEnabled,
  backendLabel,
  readyAgentBackends,
} from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";

function AgentIdentity({
  backend,
  checking,
}: {
  backend: AgentBackendId;
  checking: boolean;
}) {
  const { t } = useAppTranslation();
  const backendName = backendLabel(backend);
  return (
    <div
      aria-label={t("chat.composer.agent.current", { backend: backendName })}
      aria-busy={checking}
      className="flex size-8 shrink-0 items-center justify-center"
      title={t("chat.composer.agent.current", { backend: backendName })}
    >
      <AgentBackendIcon backend={backend} className="size-4" />
      {checking && (
        <span className="sr-only" role="status">
          {t("chat.composer.agent.checking", { backend: backendName })}
        </span>
      )}
    </div>
  );
}

export function ChatAgentSelector({
  value,
  backends,
  locked,
  checking,
  disabled,
  saving,
  onChange,
}: {
  value: AgentBackendId;
  backends: BackendInfo[];
  locked: boolean;
  checking?: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: (backend: AgentBackendId) => Promise<void>;
}) {
  const { t } = useAppTranslation();
  const available = readyAgentBackends(backends);
  const displayed =
    available.find((backend) => backend.id === value) ?? available[0];
  const displayId = displayed?.id ?? value;
  const fallbackAttempt = useRef("");

  useEffect(() => {
    const key = displayed ? `${value}:${displayed.id}` : "";
    if (
      locked ||
      checking ||
      saving ||
      !displayed ||
      displayed.id === value ||
      fallbackAttempt.current === key
    ) {
      return;
    }
    fallbackAttempt.current = key;
    void onChange(displayed.id).catch(() => undefined);
  }, [checking, displayed, locked, onChange, saving, value]);

  if (!agentSelectionEnabled(backends, locked)) {
    return (
      <AgentIdentity
        backend={locked ? value : displayId}
        checking={Boolean(checking)}
      />
    );
  }

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1">
      <Select
        value={displayId}
        disabled={disabled || saving}
        onValueChange={(backend) =>
          void onChange(backend as AgentBackendId)
        }
      >
        <SelectTrigger
          aria-label={t("chat.composer.agent.selectCurrent", {
            backend: backendLabel(displayId),
          })}
          aria-busy={checking}
          className="size-8 min-w-0 cursor-pointer justify-center gap-0 rounded-full border-0 bg-transparent p-0 shadow-none outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-muted data-[size=default]:h-8 disabled:cursor-not-allowed [&>svg:last-child]:hidden"
          title={
            checking
              ? t("chat.composer.agent.checking", {
                  backend: backendLabel(displayId),
                })
              : t("chat.composer.agent.current", {
                  backend: backendLabel(displayId),
                })
          }
        >
          <AgentBackendIcon backend={displayId} className="size-4" />
        </SelectTrigger>
        {/* side/align 是本处的真实意图：composer 贴着底边，菜单只能向上向右开。
            position 不再声明——原语默认已是 popper。 */}
        <SelectContent
          side="top"
          align="end"
          sideOffset={4}
          className="w-max max-w-[calc(100vw-2rem)] p-1"
        >
          {available.map((backend) => (
            <SelectItem
              key={backend.id}
              value={backend.id}
              className="min-h-9 cursor-pointer px-2.5 pr-8 text-sm whitespace-nowrap"
            >
              <span className="flex items-center gap-2">
                <AgentBackendIcon
                  backend={backend.id}
                  className="size-4"
                />
                <span>{backend.displayName}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {checking && (
        <span className="sr-only" role="status">
          {t("chat.composer.agent.checking", {
            backend: backendLabel(displayId),
          })}
        </span>
      )}
    </div>
  );
}
