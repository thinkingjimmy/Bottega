/**
 * [INPUT]: Depends on discriminated navigation rows and the reorder-aware row wrapper.
 * [OUTPUT]: Renders one ordered list while preserving each row's original authority boundary.
 * [POS]: Desktop list composition; pagination belongs to the containing root or Project section, drag state to the enclosing ChatReorderList.
 */
import { ChatNavigationRow } from "../reorder/chat-navigation-row";
import { chatRowId } from "../reorder/context";
import type { ChatNavigationRow as NavigationRow } from "./order";
export function ChatNavigationRows({ rows, project = false, editBadge }: { rows: NavigationRow[]; project?: boolean; editBadge?: string }) {
  return rows.map(row => <ChatNavigationRow key={chatRowId(row)} row={row} project={project} editBadge={editBadge} />);
}
