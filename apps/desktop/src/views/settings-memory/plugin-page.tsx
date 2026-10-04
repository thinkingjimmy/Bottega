/**
 * [INPUT]: Depends on the lazy Memory settings page, its existing frame, Memory catalog loading and the renderer locale.
 * [OUTPUT]: Provides MemoryPluginPage, the plugin entry into the unchanged Memory settings controls and dialogs.
 * [POS]: T-M3 host adapter; loads the existing page and copy together without adding a second master switch or backend form.
 */
import { lazy, Suspense } from "react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { effectiveLocale } from "@/lib/appearance/i18n-locale";
import { loadSection } from "../../../shared/i18n/sections";
import { MemorySettingsFrame, type MemoryPageOptions } from "./page-frame";

const MemorySettingsView = lazy(() => Promise.all([
  import("../settings/memory/settings-memory"), loadSection("memory", effectiveLocale()),
]).then(([module]) => ({ default: module.MemorySettingsView })));

export function MemoryPluginPage(props: MemoryPageOptions & { onAbout(): void }) {
  return <Suspense fallback={<MemorySettingsFrame {...props}><SettingsCanvas>
    <Skeleton className="h-32 w-full rounded-lg" />
  </SettingsCanvas></MemorySettingsFrame>}>
    <MemorySettingsView {...props} />
  </Suspense>;
}
