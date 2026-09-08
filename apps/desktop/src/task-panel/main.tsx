/**
 * [INPUT]: Depends on React, the isolated TaskPanel component, and its surface stylesheet.
 * [OUTPUT]: Mounts the auxiliary task-panel renderer without product providers.
 * [POS]: Independent auxiliary renderer entry; product navigation and task control remain in main.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { TaskPanel } from "./panel";
import "./panel.css";

createRoot(document.getElementById("root")!).render(<TaskPanel />);
