/**
 * [INPUT]: Depends on the shared cloud account projection, PageShell, SlimScroller and the sign-in and password steps.
 * [OUTPUT]: Provides SyncSetup with an account-keyed password step that discards drafts on identity changes.
 * [POS]: Sync settings setup form entry; which step shows is a projection of the account state, never local navigation.
 */
import { RefreshCw } from "lucide-react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { PageShell } from "@/components/page-shell";
import { SignInStep } from "./sign-in";
import { PasswordStep } from "./password";

/* Without sync there is nothing to set, so until the first sync is confirmed the
   route is this form: one card, two steps. An account is step 1 done; the page
   never lets the reader navigate between steps by hand. */
export function SyncSetup({ state }: { state: CloudAccountState }) {
  const { t } = useAppTranslation();
  return <PageShell title={t("cloud.syncSettings")} icon={<RefreshCw />}>
    <SlimScroller className="flex h-full min-h-0 flex-col overflow-y-auto px-[clamp(2rem,5vw,4rem)] py-6">
      {state.profile ? <PasswordStep key={state.profile.userId} state={state} /> : <SignInStep state={state} />}
    </SlimScroller>
  </PageShell>;
}
