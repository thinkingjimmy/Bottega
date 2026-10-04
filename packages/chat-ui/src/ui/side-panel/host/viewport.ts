/**
 * [INPUT]: Viewport media changes.
 * [OUTPUT]: Narrow-panel breakpoint state shared by hosts.
 * [POS]: Panel geometry adapter; Router history remains host-owned.
 */
import { useEffect, useState } from "react";
export function useNarrowPanel() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  useEffect(() => { const query = window.matchMedia("(max-width: 1023px)"), update = () => setNarrow(query.matches); query.addEventListener("change", update); update(); return () => query.removeEventListener("change", update); }, []);
  return narrow;
}
