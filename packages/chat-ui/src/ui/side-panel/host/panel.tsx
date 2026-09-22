/**
 * [INPUT]: Chat identity, Router takeover history, shared shell/model and authority-checked Base resolution.
 * [OUTPUT]: useChatSidePanel: header commands, retained Base state, resolver recovery and previews that close only after invoking an available composer callback.
 * [POS]: Shared panel composition root with host-owned Base authority and navigation; host routes register draft reasons with the workspace guard and supply artifact capabilities.
 */
import { usePanelLayout, type PanelWidths } from "../layout";
import { PanelHost, type PanelLeaf } from "../frame";
import { WorkspacePreview, type WorkspacePreviewRequest } from "../workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BotIcon, DatabaseIcon, ImageIcon, GlobeIcon, BlocksIcon, LoaderCircle } from "lucide-react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { TranscriptSource } from "../../../platform/contracts";
import { ArtifactHostProvider, useArtifactHost, type ArtifactHost } from "../../../artifacts/context";
import { ArtifactPreview } from "../../../artifacts/renderer";
import { useConversationModel } from "../../conversation/body/model";
import { decodeImageIdentity, encodeImageIdentity, resolveImage, type ImageIdentity, type ImageRegion } from "../image/identity";
import { sidePanelCopy } from "../../../i18n/side-panel";
import { SidePanelShell } from "@ai-chat/ui/components/workspace/side-panel/shell";
import type { SidePanelTab } from "@ai-chat/ui/components/workspace/side-panel/tabs";
import { SidePanelCatalog, SidePanelAddMenu } from "@ai-chat/ui/components/workspace/side-panel/catalog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SIDE_PANEL_MIN_WIDTH } from "@ai-chat/ui/lib/side-panel-layout";
import { conversationKey, panelWidth, panelMemory, sanitizeSlots, savePanelWidth, type PanelSlots, type PanelTabId } from "./memory";
import { remoteCopy } from "../../../i18n/remote";
import { panelCatalog } from "./catalog";
import { SubagentsTab } from "./subagents-tab";
import { ImageTab } from "./image-tab";
type ArtifactPreviewValue = { fence: ArtifactFence; followUp?: ArtifactHost["followUp"] };
type Preview = ArtifactPreviewValue | { workspace: WorkspacePreviewRequest };
import type { PanelServices } from "./ports";
import { useNarrowPanel } from "./viewport";
const widths: PanelWidths = { read: preview => panelWidth(window.innerWidth, preview), write: savePanelWidth };
export function useChatSidePanel(head: CloudChatHead | null, source: TranscriptSource, locale: string, services: PanelServices) {
  const memory = services.memory ?? panelMemory, canInstallApps = services.canInstallApps ?? true;
  const eligible = Boolean(head && head.chat.classification.conversationKind === "ordinary"), chatId = head?.chat.id ?? "", incarnationId = head?.chat.incarnationId ?? "";
  const key = conversationKey(chatId, incarnationId), copy = sidePanelCopy(locale), narrow = useNarrowPanel(), model = useConversationModel();
  const [cycle, setCycle] = useState(0), base = services.useBase(head, cycle), BaseTab = services.BaseTab;
  const rememberIntent = useCallback((open: boolean) => memory.rememberOpenIntent(conversationKey(chatId, incarnationId), open), [memory, chatId, incarnationId]);
  const history = services.useHistory(eligible, narrow, memory.readOpenIntent(key), rememberIntent);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewKey = preview ? "fence" in preview ? preview.fence.id : preview.workspace.key : null;
  const { containerRef, geometry, widthChange } = usePanelLayout(services.widths ?? widths, previewKey);
  const triggerRef = useRef<HTMLButtonElement>(null), backRef = useRef<HTMLButtonElement>(null);
  const [slots, setSlots] = useState<PanelSlots>(() => memory.readSlots(key, () => true)), [slotKey, setSlotKey] = useState(key);
  const [baseEngaged, setBaseEngaged] = useState(false), [dirty, setDirty] = useState(false), [creating, setCreating] = useState(false), [creationError, setCreationError] = useState("");
  const createFlight = useRef(false), mounted = useRef(true), tabRefs = useRef(new Map<string, HTMLDivElement>());
  const [acceptedBase, setAcceptedBase] = useState(base.target);
  if (base.resolved && acceptedBase?.baseId !== base.target?.baseId) setAcceptedBase(base.target);
  if (slotKey !== key) { setSlotKey(key); setSlots(memory.readSlots(key, () => true)); setBaseEngaged(false); setAcceptedBase(null); setPreview(null); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (history.takeover) backRef.current?.focus(); }, [history.takeover]);
  const imageAllowed = useCallback((region: ImageRegion) => {
    const identity = decodeImageIdentity(region);
    return model.chatId === chatId && model.incarnationId === incarnationId && Boolean(identity && resolveImage(identity, model.bodies, copy.catalog.image.label));
  }, [model, chatId, incarnationId, copy.catalog.image.label]);
  if (model.ready && model.chatId === chatId && model.incarnationId === incarnationId) {
    const next = sanitizeSlots(slots, imageAllowed);
    if (JSON.stringify(slots) !== JSON.stringify(next)) setSlots(next);
  }
  useEffect(() => { if (slotKey === key && (!slots.tabs.some(id => id.startsWith("image:")) || model.ready)) memory.writeSlots(key, slots); }, [memory, key, slotKey, slots, model.ready]);
  if (history.open && base.resolved && base.target && !slots.touched && !slots.tabs.length) {
    setSlots({ tabs: ["base"], active: "base", touched: true });
  }
  if (!baseEngaged && history.open && slots.tabs.includes("base")) setBaseEngaged(true);
  const openTab = useCallback((id: PanelTabId) => {
    setPreview(null); setSlots(previous => ({ tabs: previous.tabs.includes(id) ? previous.tabs : [...previous.tabs, id], active: id, touched: true }));
  }, []);
  const openShell = () => { if (!history.open) setCycle(value => value + 1); setPreview(null); history.openShell(); };
  const close = () => { history.close(); requestAnimationFrame(() => triggerRef.current?.focus()); };
  const onOpenImage = (identity: ImageIdentity) => {
    const message = identity.kind === "generated" ? model.bodies.find(body => body.message.id === identity.messageId) : null;
    const region = encodeImageIdentity(message && identity.kind === "generated" ? { ...identity, messageId: `seq:${message.message.seq}` } : identity); if (!eligible || !imageAllowed(region)) return;
    openTab(region); history.openShell(); requestAnimationFrame(() => tabRefs.current.get(region)?.focus());
  };
  const openHistory = history.openShell;
  const onOpenArtifact = useCallback((fence: ArtifactFence, followUp?: ArtifactHost["followUp"]) => {
    setPreview({ fence, followUp }); openHistory();
  }, [openHistory]);
  const openCatalog = async (id: string) => {
    if (id === "subagents") { openTab(id); return; }
    if (id !== "base" || creating || createFlight.current || !head || !base.resolved || base.error) return;
    if (base.target) { openTab("base"); return; }
    if (base.promoted || creationError === "base-identity-mismatch") { setCreationError("base-identity-mismatch"); return; }
    createFlight.current = true; setCreating(true); setCreationError("");
    try {
      await services.createBase(head);
      if (mounted.current) { openTab("base"); base.retry(); }
    } catch (error) { if (mounted.current) setCreationError(error instanceof Error ? error.message : "create-failed"); }
    finally { createFlight.current = false; if (mounted.current) setCreating(false); }
  };
  const ownerName = services.deviceName, remote = remoteCopy(locale);
  const directory = panelCatalog(copy, slots, remote.onComputer.replace("{name}", ownerName ?? remote.computer), services.capabilities);
  const catalog = { ...directory, onOpen: (id: string) => void openCatalog(id), disabledFor: (id: string) => directory.disabledFor(id) || id === "base" && (creating || !base.resolved || base.error) };
  const visible = history.open && (narrow ? history.takeover : geometry.maxWidth >= SIDE_PANEL_MIN_WIDTH);
  const items: SidePanelTab[] = slots.tabs.map(id => {
    const identity = decodeImageIdentity(id), image = identity && resolveImage(identity, model.bodies, copy.catalog.image.label);
    const label = id === "base" ? copy.catalog.base.label : id === "subagents" ? copy.catalog.subagents.label : id === "browser" ? copy.catalog.browser.label : id.startsWith("app:") ? copy.catalog.app.label : image?.label ?? copy.catalog.image.label;
    const Icon = id === "base" ? DatabaseIcon : id === "subagents" ? BotIcon : id === "browser" ? GlobeIcon : id.startsWith("app:") ? BlocksIcon : ImageIcon;
    const unavailable = id === "browser" && !services.capabilities.browser || id.startsWith("app:") && !services.capabilities.apps;
    return { key: id, label, ...(unavailable ? { dim: true, hint: remote.onComputer.replace("{name}", ownerName ?? remote.computer) } : {}), icon: <Icon className="size-3.5 shrink-0" />, selected: slots.active === id, panelId: `panel-tab-${id}`,
      closeLabel: copy.closeNamed.replace("{name}", label), select: () => setSlots(previous => ({ ...previous, active: id, touched: true })),
      close: () => setSlots(previous => { const index = previous.tabs.indexOf(id), tabs = previous.tabs.filter(tab => tab !== id); return { tabs, active: previous.active === id ? tabs[Math.min(index, tabs.length - 1)] ?? null : previous.active, touched: true }; }) };
  });
  const add = <SidePanelAddMenu {...catalog} label={copy.add} fullLabel={copy.allOpen} />;
  const promotedPath = base.promoted;
  const leaves: PanelLeaf[] = [
    { id: "base-authority", managesVisibility: true, view: <>    {baseEngaged && <BaseTab chatId={chatId} incarnationId={incarnationId} targetBaseId={acceptedBase?.baseId ?? null} project={acceptedBase?.project ?? false} locale={locale} onDirtyChange={setDirty} visible={visible && !preview && slots.active === "base"} />}
    {!preview && base.error && <div role="alert" className="p-4 text-sm">{copy.resolveFailed}<Button variant="outline" onClick={base.retry}>{copy.retry}</Button></div>}
    {!preview && slots.active === "base" && !base.error && !acceptedBase && !dirty && <div role="status" className="grid flex-1 place-content-center gap-3 p-4 text-sm">
      {base.resolved ? <><p>{copy.noBase}</p><Button variant="outline" disabled={creating || base.error} onClick={() => void openCatalog("base")}>{copy.create}</Button></> : <p>{copy.loadingBase}</p>}
    </div>}
</> },
    ...(slots.tabs.includes("subagents") ? [{ id: "subagents", view: <SubagentsTab chatId={chatId} source={source} locale={locale} onOpenImage={onOpenImage} /> }] : []),
    ...slots.tabs.filter((id): id is ImageRegion => id.startsWith("image:")).map(id => ({ id,
      view: <ImageTab region={id} chatId={chatId} source={source} locale={locale} active={visible && !preview && slots.active === id} /> })),
    ...slots.tabs.filter(id => id === "browser" || id.startsWith("app:")).map(id => ({ id, view:
      <div role="status" className="grid flex-1 place-content-center gap-3 p-4 text-sm text-muted-foreground">
        <p>{remote.onComputer.replace("{name}", ownerName ?? remote.computer)}</p>
        {id.startsWith("app:") && canInstallApps && <Button variant="link" onClick={() => services.navigate("/apps")}>{remote.installApp}</Button>}
      </div> })),
  ];
  const element = (eligible || baseEngaged) && <SidePanelShell open={visible} takeover={history.takeover} {...geometry} onWidthChange={widthChange} onClose={close} resizeLabel={copy.resize} resizeHint={copy.resizeHint}>
    <PanelHost close={close} backRef={backRef} takeover={history.takeover} copy={copy}
      title={preview || history.takeover ? (preview ? "fence" in preview ? preview.fence.title : preview.workspace.title : null) ?? items.find(item => item.selected)?.label ?? copy.tabs : undefined}
      hideTabs={Boolean(preview)} items={items} refs={tabRefs} tabsLabel={copy.tabs} closeTabLabel={copy.closeTab}
      active={preview ? null : slots.active} leaves={leaves} add={!preview ? add : undefined} footer={<>
    {!preview && !slots.tabs.length && (!base.resolved && !base.error ? <div role="status" className="grid flex-1 place-items-center"><span className="sr-only">{copy.loadingBase}</span><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div> : <>
      <SidePanelCatalog {...catalog} />
      {!services.capabilities.apps && canInstallApps && <Button variant="link" onClick={() => services.navigate("/apps")}>{remote.installApp}</Button>}
    </>)}
    {!preview && creating && <p role="status" className="px-4 py-2 text-sm">{copy.loadingBase}</p>}
    {!preview && creationError && <p role="alert" className="px-4 py-2 text-sm">{creationError === "base-identity-mismatch" ? copy.basePromoted : copy.createFailed}{promotedPath && <a className="ml-2 underline" href={promotedPath} onClick={event => { event.preventDefault(); services.navigate(promotedPath); }}>{copy.openFull}</a>}</p>}
    {preview && visible && ("workspace" in preview ? <WorkspacePreview request={preview.workspace} copy={{ loading: remote.readingFile, failed: remote.requestFailed, retry: copy.retry }} /> : <ExpandedArtifact preview={preview} close={history.close} />)}
    </>} />
  </SidePanelShell>;
  return { eligible, containerRef, triggerRef, takeover: history.takeover, openShell, onOpenImage, onOpenArtifact, onOpenWorkspaceFile: (workspace: WorkspacePreviewRequest) => { setPreview({ workspace }); history.openShell(); }, dirty, element };
}
function ExpandedArtifact({ preview, close }: { preview: ArtifactPreviewValue; close(): void }) {
  const host = useArtifactHost();
  const followUp = preview.followUp ?? host?.followUp;
  const value = useMemo(() => host ? { ...host, followUp: followUp ? (request: { prompt: string; title?: string }) => { followUp(request); close(); } : undefined } : null, [host, followUp, close]);
  return <ArtifactHostProvider value={value}><div className="min-h-0 flex-1 overflow-auto px-6 py-5 text-sm"><ArtifactPreview key={preview.fence.id} fence={preview.fence} expanded /></div></ArtifactHostProvider>;
}
