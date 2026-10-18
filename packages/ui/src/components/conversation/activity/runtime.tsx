/**
 * [INPUT]: Uses React context and structural activity tool identities.
 * [OUTPUT]: Provides ToolActivityProvider and useToolActivity for host-owned command status, output and detail actions.
 * [POS]: Optional execution state inside existing command rows; owns no layout or execution authority.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { ActivityTool } from "./groups";

export type ToolActivityState = {
  status: ActivityTool["status"];
  detail: string;
  actions?: ReactNode;
  description?: ReactNode;
};
type Resolver = (part: ActivityTool) => ToolActivityState | undefined;
const ToolActivityContext = createContext<Resolver>(() => undefined);
export const ToolActivityProvider = ToolActivityContext.Provider;
export const useToolActivity = () => useContext(ToolActivityContext);
