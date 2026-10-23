/**
 * [INPUT]: Depends on Electron's pre-ready command line and the native platform.
 * [OUTPUT]: Provides configureRendererRetirement for the standard two-second subframe reuse window.
 * [POS]: Shared browser startup policy, called by both desktop entries before loading the composition root.
 */
import { app } from "electron";

export function configureRendererRetirement() {
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  // Artifact origins are lease-specific. Chromium 150's ten-second reuse experiment
  // retains obsolete renderers without reuse; its disabled branch keeps two seconds
  // plus the independent unload timeout, with sandbox and site isolation intact.
  const feature = "SubframeProcessShutdownDelay";
  // First override wins in Chromium; an existing *Feature means use its default.
  const disabled = new Set(app.commandLine.getSwitchValue("disable-features").split(",").map(value => value.trim())
    .filter(value => value && value.replace(/^\*/, "").split("<", 1)[0] !== feature));
  disabled.add(feature);
  app.commandLine.appendSwitch("disable-features", [...disabled].join(","));
}
