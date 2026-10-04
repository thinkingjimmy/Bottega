/**
 * [INPUT]: Depends on React, the isolated DockBar component, and the shared Dock base and bar stylesheets.
 * [OUTPUT]: Mounts the Bottega Dock bar renderer without product providers, router, or the app shell.
 * [POS]: system-dock/bar entry loaded by src/system-dock-bar.html; everything product-side stays behind main and the isolated preload.
 */
import { createRoot } from "react-dom/client";
import { DockBar } from "./bar";
import "../common/base.css";
import "./bar.css";

createRoot(document.getElementById("root")!).render(<DockBar />);
