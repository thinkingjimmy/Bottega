/**
 * [INPUT]: Complete bounded summary status/revision changes, localized plugin copy, the shared FeedbackToast surface, and Settings navigation.
 * [OUTPUT]: Confirmed revision update notices and one dismissible grouped failure notice with a repair destination; diagnostics stay in plugin details.
 * [POS]: Persistent main-window feedback; initial catalog loading never announces an update.
 */
import { useEffect, useRef } from "react";
import { CircleAlert } from "lucide-react";
import { FeedbackToast, FeedbackToastAction, toast } from "@ai-chat/ui/components/ui/sonner";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useUnifiedPluginIndex } from "@/lib/plugin-platform/projection/runtime";
import { pluginPlatformCopy } from "@/lib/plugin-platform/copy";
import { requestSettingsSection } from "@/lib/settings/navigation/settings-navigation";

const FAILURE_TOAST_ID = "plugin-runtime-failure";
type PreviousState = { revision?: string; status: string; error?: string };
const failed = ({ status, error }: { status: string; error?: string }) =>
  status === "failed" || status === "cleanup-failed" || (status === "ready" && Boolean(error));

export function PluginUpdateNotices() {
  const { items, page } = useUnifiedPluginIndex();
  const { i18n } = useAppTranslation();
  const previous = useRef(new Map<string, PreviousState>());
  const loaded = useRef(false);

  useEffect(() => () => { toast.dismiss(FAILURE_TOAST_ID); }, []);

  useEffect(() => {
    if (!page) return;
    const copy = pluginPlatformCopy(i18n.language);
    const next = new Map<string, PreviousState>();
    let newFailure = false;
    for (const item of items) {
      const prior = previous.current.get(item.manifest.id);
      if (loaded.current) {
        if (prior?.revision && item.runtimeReady && item.activeRevision && prior.revision !== item.activeRevision) {
          toast.success(`${item.manifest.name} · ${copy.updated}`, {
            id: `plugin-update:${item.manifest.id}`,
            description: `${item.instanceCount} ${copy.instances}`,
            action: { label: copy.details, onClick: () => requestSettingsSection({ section: "plugins", plugin: item.manifest.id }) },
          });
        }
        if (failed(item) && (prior?.error !== item.error || prior?.status !== item.status)) {
          newFailure = true;
        }
      }
      next.set(item.manifest.id, { revision: item.activeRevision, status: item.status, error: item.error });
    }
    // Unavailable includes unsupported features and setup requirements, which stay in Settings.
    const failures = items.filter(failed);
    const previousCount = [...previous.current.values()].filter(failed).length;
    const visible = toast.getToasts().some(item => item.id === FAILURE_TOAST_ID);
    if (failures.length === 0) {
      toast.dismiss(FAILURE_TOAST_ID);
    } else if (newFailure || (visible && previousCount !== failures.length)) {
      const plugin = failures.length === 1 ? failures[0] : undefined;
      const description = plugin
        ? copy.failureToastSingle.replace("{{name}}", () => plugin.manifest.name)
        : copy.failureToastMultiple.replace("{{count}}", String(failures.length));
      toast.custom(id => (
        <FeedbackToast
          data-plugin-failure-notice=""
          className="w-full max-w-full [&>button]:size-10"
          icon={<CircleAlert className="text-destructive" />}
          title={copy.failureToastTitle}
          description={description}
          onDismiss={() => { toast.dismiss(id); }}
        >
          <FeedbackToastAction className="min-h-10 px-3" variant="outline" onClick={() => {
            toast.dismiss(id);
            requestSettingsSection({ section: "plugins", ...(plugin ? { plugin: plugin.manifest.id } : {}) });
          }}>{copy.details}</FeedbackToastAction>
        </FeedbackToast>
      ), {
        id: FAILURE_TOAST_ID,
        duration: 8_000,
        unstyled: true,
        style: { width: "min(22rem, calc(100vw - 2rem))" },
      });
    }
    previous.current = next;
    loaded.current = true;
  }, [items, page, i18n.language]);
  return null;
}
