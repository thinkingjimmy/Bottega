"use client";

/**
 * [INPUT]: Depends on React Context and lib/appearance types, DOM application and persistence functions
 * [OUTPUT]: Provides AppearanceProvider/useAppearance for reading and updating appearance preferences
 * [POS]: Single source of truth for appearance state; consumed by the renderer root and Settings view
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  applyAppearance,
  type AppearancePreferences,
  writeAppearance,
} from "@/lib/appearance";

type AppearanceContextValue = {
  appearance: AppearancePreferences;
  updateAppearance: (partial: Partial<AppearancePreferences>) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({
  children,
  initialAppearance,
}: {
  children: React.ReactNode;
  initialAppearance: AppearancePreferences;
}) {
  const [appearance, setAppearance] = useState(initialAppearance);

  const updateAppearance = useCallback(
    (partial: Partial<AppearancePreferences>) => {
      setAppearance((current) => {
        const next = { ...current, ...partial };
        applyAppearance(next);
        writeAppearance(next);
        return next;
      });
    },
    []
  );

  const value = useMemo(
    () => ({ appearance, updateAppearance }),
    [appearance, updateAppearance]
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance 必须在 AppearanceProvider 内使用");
  return context;
}
