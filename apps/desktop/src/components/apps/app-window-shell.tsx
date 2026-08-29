/**
 * [INPUT]: Depends on React lazy/Suspense, scoped App/Bases/Chats/Projects/backend-runtime providers, lazy AppDetailView, router, message renderer, and tooltip context
 * [OUTPUT]: Provides AppWindowShell, a fixed-App full-window route tree with no sidebar chrome, Settings, Browser, or global navigation (a collapsed SidebarProvider stays mounted only to satisfy PageShell's useSidebar)
 * [POS]: Renderer App-window presentation root; it reuses the App detail's main surface and use-chat third panel without duplicating product state
 */

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { MessageRendererProvider } from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { SidebarProvider } from "@ai-chat/ui/components/ui/sidebar";
import { AppsProvider } from "@/components/providers/apps-provider";
import { BasesProvider } from "@/components/providers/bases-provider";
import { ChatsProvider } from "@/components/providers/chats-provider";
import { ProjectsProvider } from "@/components/providers/projects-provider";
import { AppRuntimeSetupProvider } from "@/components/providers/setup-provider";
import { CHAT_FENCE_RENDERERS } from "@/components/charts/chart-fence-renderers";

const AppDetailView = lazy(() =>
  import("@/views/app-detail").then((module) => ({ default: module.AppDetailView }))
);

export function AppWindowShell({ appId }: { appId: string }) {
  const route = `/apps/${appId}/app`;
  return (
    <AppRuntimeSetupProvider>
      <AppsProvider fixedAppId={appId}>
        <ProjectsProvider>
          <ChatsProvider includeActivity={false}>
            <BasesProvider>
            <MessageRendererProvider value={CHAT_FENCE_RENDERERS}>
              <TooltipProvider>
                {/* 无侧栏 UI,但 AppDetailView → PageShell 会调用 useSidebar();
                    折叠态 Provider 只为满足该 context,勿当作死代码删除。 */}
                <SidebarProvider
                  keyboardShortcut={false}
                  open={false}
                  className="block h-svh min-h-0 bg-background"
                >
                  <div className="h-svh min-h-0 overflow-hidden bg-background">
                    <Suspense fallback={null}>
                      <Routes>
                        <Route path="/apps/:id/:surface?" element={<AppDetailView />} />
                        <Route path="*" element={<Navigate replace to={route} />} />
                      </Routes>
                    </Suspense>
                  </div>
                </SidebarProvider>
              </TooltipProvider>
            </MessageRendererProvider>
            </BasesProvider>
          </ChatsProvider>
        </ProjectsProvider>
      </AppsProvider>
    </AppRuntimeSetupProvider>
  );
}
