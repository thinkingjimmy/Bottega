/**
 * [INPUT]: Depends on React, the isolated DockPanel component, and the shared Dock base and panel stylesheets.
 * [OUTPUT]: Mounts the Bottega Dock panel renderer without product providers, router, or the app shell.
 * [POS]: system-dock/panel entry loaded by src/system-dock-panel.html; one lazily created window serves every detail, add, edit and keyboard view (5.2).
 */
import { createRoot } from "react-dom/client";
import { DockPanel } from "./panel";
import "../common/base.css";
import "./panel.css";

createRoot(document.getElementById("root")!).render(<DockPanel />);
