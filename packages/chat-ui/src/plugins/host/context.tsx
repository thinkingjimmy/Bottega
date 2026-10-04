/**
 * [INPUT]: Native or Cloud plugin frame and encrypted local recovery implementations.
 * [OUTPUT]: PluginSurfaceEnvironmentProvider and usePluginSurfaceEnvironment for shared remote composers.
 * [POS]: Host injection seam; absent environments expose no runnable plugin entries.
 */
import { createContext, useContext } from 'react';
import type { PluginSurfaceEnvironment } from './contracts';
const Context = createContext<PluginSurfaceEnvironment | null>(null);
export const PluginSurfaceEnvironmentProvider = Context.Provider;
export const usePluginSurfaceEnvironment = () => useContext(Context);
