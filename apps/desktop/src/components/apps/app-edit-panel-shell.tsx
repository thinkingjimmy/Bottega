/**
 * [INPUT]: Depends on ReactNode and cn, receiving open and inert content factories
 * [OUTPUT]: Provides AppEditPanelShell; The shutdown is only zero-width aside, and no content factory is called
 * [POS]: The App edits the lifecycle valve of the sidebar, which connects the ChatView upload to the width animation to the same open condition
 */

import type { ReactNode } from "react";
import { cn } from "@ai-chat/ui/lib/utils";

export function AppEditPanelShell({
  open,
  renderContent,
}: {
  open: boolean;
  renderContent: () => ReactNode;
}) {
  return (
    <aside
      className={cn(
        "h-full overflow-hidden border-l bg-background transition-[width] duration-300 ease-in-out",
        open ? "w-[28rem]" : "w-0 border-transparent"
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="flex h-full w-[28rem] flex-col">
        {open ? renderContent() : null}
      </div>
    </aside>
  );
}
