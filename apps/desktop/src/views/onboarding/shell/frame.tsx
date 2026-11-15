/**
 * [INPUT]: The onboarding step, PRODUCT_MARK_URL/PRODUCT_NAME, settingsStore's language, LanguageSelect, SlimScroller, OnboardingPreview and the bundled wallpapers.
 * [OUTPUT]: OnboardingFrame — a full-window scene: the website's wallpaper under a veil, a brand row with the language picker at its right edge, the step's question/guidance/body in the left column and the product preview on the right — plus OnboardingActions and onboardingCopyId.
 * [POS]: Presentation shell of views/onboarding; index.tsx and the step bodies compose into it, and it carries no step progress.
 */
import { useId, useSyncExternalStore, type ReactNode } from "react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { PRODUCT_MARK_URL, PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { LanguageSelect } from "@/components/settings/general/language-select";
import { settingsStore } from "@/lib/settings/store/settings-store";
import type { OnboardingStep } from "../plan";
import { OnboardingPreview } from "./preview";
import "./onboarding.css";

const WALLPAPER = {
  light: new URL("./wallpaper-light.webp", import.meta.url).href,
  dark: new URL("./wallpaper-dark.webp", import.meta.url).href,
};

/** Copy ids predate the folder step's code id; every catalog table is keyed by them. */
export const onboardingCopyId = (step: OnboardingStep) => step === "folder" ? "chat-home" : step;

/** Actions follow the body instead of pinning to the window's edge. */
export function OnboardingActions({ children }: { children: ReactNode }) {
  return <div data-onboarding-actions="" className="mt-6 flex min-w-0 items-center gap-2">{children}</div>;
}

export function OnboardingFrame({ step, title, description, children }: {
  step: OnboardingStep | null;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const heading = `${useId()}-title`;
  const language = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot).settings?.language ?? null;
  return <div data-setup-frame="" data-onboarding-step={step ?? "loading"} className="onboarding-scene">
    <img src={WALLPAPER.light} alt="" aria-hidden="true" draggable={false} className="onboarding-wallpaper dark:hidden" />
    <img src={WALLPAPER.dark} alt="" aria-hidden="true" draggable={false} className="onboarding-wallpaper hidden dark:block" />
    <div aria-hidden="true" className="onboarding-veil" />
    <OnboardingPreview step={step ?? "folder"} />
    {/* The whole top band drags the window; only the language picker opts out of it. */}
    <div data-onboarding-drag="" className="onboarding-brand">
      <div>
        <img src={PRODUCT_MARK_URL} alt="" className="onboarding-mark" />
        <span className="font-semibold">{PRODUCT_NAME}</span>
      </div>
      <div className="onboarding-no-drag">
        <LanguageSelect standalone language={language} className="onboarding-language" />
      </div>
    </div>
    <SlimScroller className="onboarding-scroll">
      <main aria-labelledby={title ? heading : undefined} className="onboarding-column">
        {title && <header className="onboarding-rise onboarding-header">
          <h1 id={heading} className="onboarding-title">{title}</h1>
          {description && <p className="onboarding-lede">{description}</p>}
        </header>}
        <div className="onboarding-rise onboarding-body">{children}</div>
      </main>
    </SlimScroller>
  </div>;
}
