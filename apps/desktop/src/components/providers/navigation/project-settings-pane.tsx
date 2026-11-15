"use client";

/**
 * [INPUT]: Depends on react-router location for the deep-link restore target
 * [OUTPUT]: Provides ProjectSettingsPaneProvider, useProjectSettingsPane, and the ProjectSettingsPaneState contract
 * [POS]: Navigation state for the Project Settings right pane; one pane replaces the old tabbed route without owning routing
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";

export type ProjectSettingsPaneFocus =
  | "general"
  | "instructions"
  | "apps"
  | "base"
  | "skills";

export type ProjectSettingsPaneState = {
  projectId: string;
  focus?: ProjectSettingsPaneFocus;
  packageFilter?: string;
};

type ProjectSettingsPaneNavigation = {
  pane: ProjectSettingsPaneState | null;
  open(state: ProjectSettingsPaneState): void;
  close(): void;
  /* The last non-settings location, so the /projects/:id/settings alias can
     restore where the person stood before the deep link fired. */
  restoreTarget(): string | null;
};

const ProjectSettingsPaneContext =
  createContext<ProjectSettingsPaneNavigation | null>(null);

/* Routes that must never become the restore target: the settings overlay
   family and the project-settings alias itself. */
const SETTINGS_PATH = /^\/(settings|projects\/[^/]+\/settings)(\/|$)/;

export function ProjectSettingsPaneProvider({
  children,
}: {
  children: ReactNode;
}) {
  const location = useLocation();
  const [pane, setPane] = useState<ProjectSettingsPaneState | null>(null);
  const lastRoute = useRef<string | null>(null);

  useEffect(() => {
    if (!SETTINGS_PATH.test(location.pathname)) {
      lastRoute.current = `${location.pathname}${location.search}${location.hash}`;
    }
  }, [location]);

  /* open/close/restoreTarget stay referentially stable: consumers sit in
     effect dependency lists, and a fresh function per render would turn
     "open the pane" into a setState loop. */
  const open = useCallback((state: ProjectSettingsPaneState) => {
    setPane((current) =>
      current !== null &&
      current.projectId === state.projectId &&
      current.focus === state.focus &&
      current.packageFilter === state.packageFilter
        ? current
        : state
    );
  }, []);
  const close = useCallback(() => setPane(null), []);
  const restoreTarget = useCallback(() => lastRoute.current, []);

  const value = useMemo<ProjectSettingsPaneNavigation>(() => ({
    pane,
    open,
    close,
    restoreTarget,
  }), [pane, open, close, restoreTarget]);

  return (
    <ProjectSettingsPaneContext.Provider value={value}>
      {children}
    </ProjectSettingsPaneContext.Provider>
  );
}

export function useProjectSettingsPane() {
  return useContext(ProjectSettingsPaneContext);
}
