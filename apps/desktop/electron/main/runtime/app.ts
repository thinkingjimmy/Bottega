/**
 * [INPUT]: Depends on electron's app, the runtime port and the auxiliary process watchdog's launch hook.
 * [OUTPUT]: Installs this app's runtime port on import (packaged or not, the Resources directory, the main bundle's directory, platform and arch) and names the watchdog's launch on it.
 * [POS]: The runtime port's composition for the Electron main process, imported once by main's entry (index.ts) before anything launches.
 */
import { app } from "electron";
import { configureProcessWatchdog, watchdogLaunch } from "../agent/process/agent-process-watchdog";
import { createRuntimePort, installRuntimePort } from "./index";

const port = createRuntimePort({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDirectory: __dirname,
  platform: process.platform, arch: process.arch });
installRuntimePort(port);
configureProcessWatchdog(() => watchdogLaunch(port));
