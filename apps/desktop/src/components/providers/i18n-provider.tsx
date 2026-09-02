"use client";

/**
 * [INPUT]: Depends on React, react-i18next, shared i18n runtime/catalogs/locale, renderer locale and system file-manager facts, and an optional main-window Settings subscription
 * [OUTPUT]: Provides AppI18nProvider/useAppTranslation plus shared platform-correct Reveal copy with preload-first locale and opt-in durable Settings synchronization
 * [POS]: Renderer language lifecycle owner; App windows keep their preload locale without acquiring the global Settings envelope
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { I18nextProvider, setI18n, useTranslation } from "react-i18next";
import type { AppLocale } from "../../../shared/i18n/locale";
import { resolveAppLocale } from "../../../shared/i18n/locale";
import type { Catalog } from "../../../shared/i18n/locales/en";
import { loadCatalog } from "../../../shared/i18n/catalogs";
import { catalogOf, createAppI18n } from "../../../shared/i18n/runtime";
import { settingsStore } from "@/lib/settings-store";
import { setEffectiveLocale } from "@/lib/i18n-locale";
import { systemFileManager } from "@/lib/agent-client";
import { UiTextProvider } from "@ai-chat/ui/lib/ui-text";

/* 组件会被测试、错误页与 Story/SSR 脱离根 Provider 单独渲染。
   英语基线让这些合法入口降级为可读文案，而不是泄漏内部 key。 */
setI18n(createAppI18n("en"));

const preferredLanguages = () => [...(navigator.languages ?? [navigator.language])];

export function AppI18nProvider({
  children,
  initialLanguage,
  syncSettings = true,
}: {
  children: ReactNode;
  initialLanguage: AppLocale;
  syncSettings?: boolean;
}) {
  const instance = useMemo(
    () => createAppI18n(initialLanguage),
    [initialLanguage]
  );
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const [systemLanguages, setSystemLanguages] = useState(preferredLanguages);
  const effectiveLanguage = settings
    ? resolveAppLocale(settings.language, systemLanguages)
    : initialLanguage;

  useEffect(() => {
    if (syncSettings) settingsStore.ensureLoaded();
  }, [syncSettings]);

  useEffect(() => {
    const update = () => setSystemLanguages(preferredLanguages());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  /* 目录懒加载之后，「有效语言」与「文案到位」必须是同一个事件：先载
     目录、再落 lang/locale 与 changeLanguage，中间不留「lang 已改、文案
     未到」的撕裂帧。目录已驻留时仍走同步路径——首帧与脱离 main.tsx 的
     单独渲染都在这条路上，它们的 layout 语义一个字都不该变。 */
  useLayoutEffect(() => {
    const applyLanguage = (catalog: Catalog) => {
      document.documentElement.lang = effectiveLanguage;
      setEffectiveLocale(effectiveLanguage);
      if (instance.language === effectiveLanguage) return;
      instance.addResourceBundle(
        effectiveLanguage,
        "translation",
        catalog,
        true,
        true
      );
      void instance.changeLanguage(effectiveLanguage);
    };

    const resident = catalogOf(effectiveLanguage);
    if (resident) {
      applyLanguage(resident);
      return;
    }
    let cancelled = false;
    void loadCatalog(effectiveLanguage).then((catalog) => {
      if (!cancelled) applyLanguage(catalog);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveLanguage, instance]);

  return (
    <I18nextProvider i18n={instance}>
      <UiTextProvider
        resolve={(key, fallback) =>
          instance.t(`ui.${key}`, { defaultValue: fallback })
        }
      >
        {children}
      </UiTextProvider>
    </I18nextProvider>
  );
}

export const useAppTranslation = useTranslation;

export function useSystemFileManagerRevealLabel() {
  const { t } = useAppTranslation();
  const manager = systemFileManager();
  if (manager === "finder") return t("common.reveal.finder");
  if (manager === "file-explorer") {
    return t("common.reveal.fileExplorer");
  }
  return t("common.reveal.fileManager");
}
