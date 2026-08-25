"use client";

/**
 * [INPUT]: Depends on React, SetupProvider, shared Personalization bridge/backend sequence, Agent brand native language, Settings fill Canvas with native language, lib with formatBytes/shortcut tables, InstructionsFind, Tabs/Textarea/Kbd and i18n
 * [OUTPUT]: Provides PersonalizationSettingsView/PersonalizationSettingsContent/InstructionsEditor; InstructionsEditor renders a card (header slot: tabs + path actions; premise band; textarea) plus a sibling action bar OUTSIDE the card (size metrics + save/⌘S), spanning cross-tab drafts, dirty state, CAS conflict refresh and read-only
 * [POS]: The single control surface of Settings › Personalization. One editor instance serves the active backend only; saving/error state is tagged with its owning backend so switching tabs needs no cleanup. Drafts live in the parent, file truth and concurrency verdicts stay in main, path actions only ever pass a backend id
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  FileText,
  FolderOpen,
  Info,
  Link2,
  Search,
  TriangleAlert,
  UserPen,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsEmpty,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-layout";
import { InstructionsFind } from "@/components/settings/instructions-find";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { formatBytes } from "@/lib/format-bytes";
import { useGlobalShortcuts, useShortcutKeys } from "@/lib/shortcuts";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Kbd, KbdGroup } from "@ai-chat/ui/components/ui/kbd";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { Textarea } from "@ai-chat/ui/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ai-chat/ui/components/ui/tabs";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../shared/agent-ipc";
import {
  PERSONALIZATION_BYTE_LIMIT,
  type AgentInstructionsErrorCode,
  type AgentInstructionsFile,
  type PersonalizationBridgeApi,
} from "../../shared/personalization-ipc";

declare global {
  interface Window {
    personalization?: PersonalizationBridgeApi;
  }
}

type FileMap = Partial<Record<AgentBackendId, AgentInstructionsFile>>;
type DraftMap = Partial<Record<AgentBackendId, string>>;

export function PersonalizationSettingsView() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const installed = useMemo(() => {
    const ids = new Set(
      (setup.status?.backends ?? [])
        .filter((backend) => backend.runtimeStatus === "installed")
        .map((backend) => backend.id)
    );
    return AGENT_BACKEND_ORDER.filter((backend) => ids.has(backend));
  }, [setup.status]);

  return (
    <PageShell title={t("settings.personalization.title")} icon={<UserPen />}>
      <PersonalizationSettingsContent
        bridge={window.personalization}
        installed={installed}
      />
    </PageShell>
  );
}

export function PersonalizationSettingsContent({
  bridge,
  installed,
}: {
  bridge: PersonalizationBridgeApi | undefined;
  installed: AgentBackendId[];
}) {
  const { t } = useAppTranslation();
  const [files, setFiles] = useState<FileMap>({});
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [selected, setSelected] = useState<AgentBackendId | null>(null);
  const [finding, setFinding] = useState(false);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [loadError, setLoadError] = useState(bridge ? "" : t("settings.personalization.errors.bridge"));

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge.list().then((next) => {
      if (!live) return;
      const fileMap = Object.fromEntries(next.map((file) => [file.backend, file])) as FileMap;
      const draftMap = Object.fromEntries(next.map((file) => [file.backend, file.content ?? ""])) as DraftMap;
      setFiles(fileMap);
      setDrafts(draftMap);
    }).catch(() => {
      if (live) setLoadError(t("settings.personalization.errors.readFailed"));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [bridge, t]);

  const activeBackend = selected && installed.includes(selected)
    ? selected
    : installed[0] ?? null;
  const activeFile = activeBackend ? files[activeBackend] : undefined;

  /* 查找条的开关住在这里而不是编辑面里：开它的入口在顶栏（顶栏属于卡片，
     不属于任何一家），而正文在编辑面里。状态跟着入口走，⌘F 与那颗按钮
     才是同一个开关的两只手。 */
  useGlobalShortcuts({ findInFile: () => setFinding(true) });

  const multi = installed.length > 1;
  const panel = activeFile && activeBackend && (
    <InstructionsEditor
      backend={activeBackend}
      bridge={bridge}
      draft={drafts[activeBackend] ?? ""}
      file={activeFile}
      finding={finding}
      header={
        /* ── 顶栏：谁在被编辑，和它是哪个文件 ─────────────────────────
            页签宽度由内容决定（w-fit），不再 flex-1 摊平在整幅上——摊平
            换来的是四个 216px 的空壳，而右端本该放这一条最该被看见的事实：
            你正在改的是磁盘上的哪个文件。

            它由这里给而不是编辑面自己长：页签要列出所有已装后端，那是
            「有哪几家」的知识，编辑面只认得自己这一家。 */
        <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b bg-sunken px-3">
          {multi && (
            <TabsList
              variant="line"
              aria-label={t("settings.personalization.sectionTitle")}
              className="h-8 w-fit shrink-0 bg-transparent p-0"
            >
              {installed.map((backend) => (
                <TabsTrigger className="flex-none cursor-pointer gap-2 px-2" key={backend} value={backend}>
                  <AgentBackendIcon backend={backend} className="size-3.5" />
                  {backendLabel(backend)}
                  {/* 唯一挂在页签上的状态：这一家有没有没存的字。它答的是
                      「别的 tab」——按钮只能替当前这家说话。 */}
                  {isDirty(files[backend], drafts[backend]) && (
                    <span aria-hidden="true" data-slot="unsaved" className="size-1.5 rounded-full bg-foreground" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          <PathBar
            bridge={bridge}
            file={activeFile}
            onFind={() => setFinding(true)}
            findable={activeFile.content !== null}
          />
        </div>
      }
      onFindClose={() => setFinding(false)}
      onDraft={(content) => setDrafts((current) => ({ ...current, [activeBackend]: content }))}
      onFile={(next) => setFiles((current) => ({ ...current, [activeBackend]: next }))}
    />
  );

  return (
    <SettingsCanvas fill>
      <SettingsSection
        title={t("settings.personalization.sectionTitle")}
        description={t("settings.personalization.description")}
        alert={loadError}
      >
        {loading ? (
          <SettingsEmpty icon={<FileText />} title={t("settings.personalization.loading")} hint={t("settings.personalization.description")} />
        ) : installed.length === 0 ? (
          <SettingsEmpty icon={<UserPen />} title={t("settings.personalization.emptyTitle")} hint={t("settings.personalization.emptyHint")} />
        ) : (
          /* 一家也走 Tabs：从前 multi 决定的是整棵树的形状（有页签走 Tabs，
             没页签直接摆卡片），于是同一个界面有两种骨架。现在 multi 只
             决定顶栏里有没有那条页签带——单家时 Tabs 退成一个 flex 列，
             而 TabsContent 仍在，正文的 tabpanel 语义不必分两种情况维护。 */
          <Tabs
            value={activeBackend ?? installed[0]}
            onValueChange={(value) => { setSelected(value as AgentBackendId); setFinding(false); }}
            className="min-h-0 flex-1 gap-3"
          >
            {panel}
          </Tabs>
        )}
      </SettingsSection>
    </SettingsCanvas>
  );
}

const isDirty = (file: AgentInstructionsFile | undefined, draft: string | undefined) =>
  Boolean(file) && !file!.oversized && file!.content !== null && draft !== undefined && draft !== file!.content;

/* ============================================================
 * 路径条：这一页最该被看见的一条事实，此前是一行不可点的灰字。
 *
 * 复制只复制链接那条（~/... 是能直接粘进终端的形状）；定位只递 backend，
 * 真身由 main 自己解析——绝对路径不穿 preload 这条约束在这里没有例外，
 * 一旦为了「点一下打开」把路径递出来，renderer 就成了路径的授权方。
 * ============================================================ */
function PathBar({
  bridge,
  file,
  findable,
  onFind,
}: {
  bridge: PersonalizationBridgeApi | undefined;
  file: AgentInstructionsFile;
  findable: boolean;
  onFind(): void;
}) {
  const { t } = useAppTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard?.writeText(file.displayPath).then(() => setCopied(true), () => {});
  };

  /* flex-1 而不是 items-end 的自然宽度：后者让内层那行保住 max-content，
     `truncate` 于是没有可收缩的约束——路径撑破顶栏，而 `justify-between`
     在溢出时把末项贴右，两块内容会直接叠在一起（真机实测：路径压在
     OpenCode 页签上）。改成占满剩余宽度、行内右对齐，收缩点就落回 code 上。 */
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        <FileText aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <code className="truncate font-mono text-muted-foreground text-xs">{file.displayPath}</code>
        <Button
          aria-label={copied ? t("settings.personalization.copied") : t("settings.personalization.copyPath")}
          className="ml-1"
          onClick={copy}
          size="icon-sm"
          variant="ghost"
        >
          {copied ? <Check /> : <Copy />}
        </Button>
        <Button
          aria-label={t("settings.personalization.reveal")}
          disabled={!bridge || !file.exists}
          onClick={() => void bridge?.reveal(file.backend)}
          size="icon-sm"
          variant="ghost"
        >
          <FolderOpen />
        </Button>
        <Button
          aria-label={t("settings.personalization.find.open")}
          disabled={!findable}
          onClick={onFind}
          size="icon-sm"
          variant="ghost"
        >
          <Search />
        </Button>
      </div>
      {/* 软链：链接与真身各一行。写盘落的是真身，链接本身保留。 */}
      {file.linkTarget && (
        <div className="flex min-w-0 items-center justify-end gap-1.5 pr-[5.25rem]">
          <Link2 aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          <code className="truncate font-mono text-muted-foreground text-xs">{file.linkTarget}</code>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 前提槽：顶栏之下唯一的一条横带，只在有话要说时才出现。
 *
 * 一个位置，几种口吻——中性用信息图标，需注意用三角，真出错才上
 * destructive。三种情形若各造一种形状，同一片区域就会长出三套表面，
 * 而它们说的都是同一件事：「在你继续打字之前，先知道这个」。
 *
 * 它不是 SettingsAlert：那是分组里的一块独立圆角条，这是卡片内的通栏带。
 * 第二个视图需要通栏带的那天，它就该搬进 settings-layout。
 * ============================================================ */
const BAND = {
  info: { icon: Info, className: "bg-muted", role: undefined },
  warn: { icon: TriangleAlert, className: "bg-muted", role: undefined },
  error: { icon: TriangleAlert, className: "bg-destructive/10 text-destructive", role: "alert" as const },
} as const;

function EditorBand({ tone, children }: { tone: keyof typeof BAND; children: ReactNode }) {
  const { className, icon: Icon, role } = BAND[tone];
  return (
    <div className={cn("flex shrink-0 items-start gap-2 border-b px-5 py-2.5", className)} role={role}>
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <p className="text-xs leading-relaxed">{children}</p>
    </div>
  );
}

/* 建议值不是限额，两者都不拦保存：Claude 官方建议 ≤200 行，Kimi 上游
   AGENTS_MD_RECOMMENDED_MAX_BYTES = 32 KiB。codex/opencode 上游没有公开
   建议值，那就如实只报硬限，而不是编一个出来。 */
const ADVISORY = {
  codex: null,
  claude: { kind: "lines", value: 200 },
  kimi: { kind: "bytes", value: 32 * 1024 },
  opencode: null,
} as const satisfies Record<
  AgentBackendId,
  { kind: "lines" | "bytes"; value: number } | null
>;

export function InstructionsEditor({
  backend,
  bridge,
  draft,
  file,
  finding,
  header,
  onDraft,
  onFile,
  onFindClose,
}: {
  backend: AgentBackendId;
  bridge: PersonalizationBridgeApi | undefined;
  draft: string;
  file: AgentInstructionsFile;
  finding: boolean;
  /** 卡片顶栏。归卡片管，不归任何一家的正文管，故由调用方给。 */
  header?: ReactNode;
  onDraft(content: string): void;
  onFile(file: AgentInstructionsFile): void;
  onFindClose(): void;
}) {
  const { t } = useAppTranslation();
  /* 「正在存」与那条红字都属于某一家的某一次保存，因此各自带上主人。切
     页签时于是不需要任何清理动作——上一家的失败对这一家本来就不成立，
     读出来就是空的。

     另一条路是给整个编辑面挂 key，靠重挂把两个字段清零。那会连顶栏的
     页签带一起重建：为了两个字段归零重来一整棵树，键盘焦点跟着一起丢。
     状态自己说清归谁，「切换时要记得清理」这件事就不存在了。 */
  const [savingFor, setSavingFor] = useState<AgentBackendId | null>(null);
  const [saveError, setSaveError] = useState<{ backend: AgentBackendId; text: string } | null>(null);
  const saving = savingFor === backend;
  const error = saveError?.backend === backend ? saveError.text : "";
  /* 查找条要拿真实的 textarea 结点去设选区，ref 不引起重渲染，故走 state。 */
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);
  const dirty = !file.oversized && file.content !== null && draft !== file.content;
  const readOnly = file.oversized || file.content === null || !bridge;

  const save = async () => {
    if (!bridge || !dirty || saving) return;
    setSavingFor(backend);
    setSaveError(null);
    const fail = (text: string) => setSaveError({ backend, text });
    try {
      const result = await bridge.save({ backend, content: draft, expectedDigest: file.digest });
      if (result.status === "ok") {
        onFile(result.file);
        onDraft(result.file.content ?? "");
      } else if (result.status === "conflict") {
        /* 只刷新基线（digest/盘面），草稿一个字不动：清掉草稿等于替用户
           销毁刚打的字。用户看过提示后再点保存，就是知情覆盖。 */
        const current: AgentInstructionsFile = result.current.oversized
          ? { ...file, exists: true, oversized: true, content: null, digest: result.current.digest, error: "oversized-file" }
          : { ...file, exists: true, oversized: false, content: result.current.content, digest: result.current.digest, error: undefined };
        onFile(current);
        fail(t("settings.personalization.errors.conflict"));
      } else {
        fail(errorCopy(t, result.code));
      }
    } catch {
      fail(t("settings.personalization.errors.writeFailed"));
    } finally {
      setSavingFor(null);
    }
  };

  useGlobalShortcuts({ saveInstructions: () => void save() });
  /* 键帽走响应式绑定：改绑换字、停用整组消失，保存按钮本身不受影响。 */
  const saveKeys = useShortcutKeys("saveInstructions");

  const failure = error || (file.error && file.error !== "oversized-file" ? errorCopy(t, file.error) : "");
  const band = failure
    ? { tone: "error" as const, text: failure }
    : file.oversized
      ? { tone: "warn" as const, text: t("settings.personalization.oversized") }
      : !file.exists
        ? { tone: "info" as const, text: t("settings.personalization.createHint", { path: file.displayPath }) }
        : null;

  const bytes = file.oversized ? (file.size ?? 0) : new TextEncoder().encode(draft).length;
  const lines = draft ? draft.split("\n").length : 0;
  const advisory = ADVISORY[backend];
  const budget = !advisory
    ? { text: t("settings.personalization.metrics.limit", { size: formatBytes(PERSONALIZATION_BYTE_LIMIT) }), over: false }
    : advisory.kind === "lines"
      ? { text: t("settings.personalization.metrics.recommendedLines", { lines: advisory.value }), over: lines > advisory.value }
      : { text: t("settings.personalization.metrics.recommendedSize", { size: formatBytes(advisory.value) }), over: bytes > advisory.value };

  return (
    <>
      {/* 卡片只包「这是哪个文件」和文件本身。TabsList 与 TabsContent 都只
          需是 Tabs 根的后代而非直接子元素，顶栏因此可以和正文一起待在卡
          片里，而动作条作为它们的兄弟落在卡片外——这是底栏出卡片却不必
          把 saving/error 上提到面板层的原因。 */}
      <SettingsSurface className="flex min-h-0 flex-1 flex-col">
        {header}
        {/* key 让正文随后端换一份 DOM。从前 Radix 卸载非活动的 TabsContent
            顺手做到了这件事，正文因此每次都从头显示；少了它，切到另一家
            会带着上一份的滚动位置，而两份文件长短不同，落点是随机的。
            它只裹住正文——顶栏不在里面，页签带不会跟着重建。 */}
        <TabsContent key={backend} value={backend} className="flex min-h-0 flex-1 flex-col">
          {band && <EditorBand tone={band.tone}>{band.text}</EditorBand>}
          <div className="relative min-h-0 flex-1">
            {finding && !readOnly && (
              <InstructionsFind onClose={onFindClose} textarea={field} value={draft} />
            )}
            <SlimScroller asChild>
              <Textarea
                aria-label={`${backendLabel(backend)} ${t("settings.personalization.sectionTitle")}`}
                className="field-sizing-fixed h-full min-h-0 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-5 py-3 font-mono focus-visible:border-0 focus-visible:ring-1 focus-visible:ring-ring/30 focus-visible:ring-inset"
                disabled={readOnly}
                onChange={(event) => onDraft(event.target.value)}
                placeholder={t("settings.personalization.placeholder")}
                ref={setField}
                value={draft}
              />
            </SlimScroller>
          </div>
        </TabsContent>
      </SettingsSurface>
      {/* ── 动作条：体量在左，动作在右。判词退场——按钮的灰与不灰本来就是
          脏态唯一需要的表征，再写一行字只是把同一件事说两遍。

          它站在卡片外，因为它说的不是「这个文件里有什么」，而是「你现在
          要对它做什么」。此前它与顶栏对称地焊在内壁上（h-10 + bg-sunken +
          border-t），于是长得像卡片的一部分——一条本属于这一页的动作，被
          读成了内容的边框。出了卡片就不必再自带底色与横线：外围本身就是
          它的留白。 */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-4">
        <p className="truncate font-mono text-muted-foreground text-xs tabular-nums">
          {formatBytes(bytes)}
          {" · "}
          {t("settings.personalization.metrics.lines", { lines })}
          {" · "}
          <span className={cn(budget.over && "font-medium text-foreground")}>{budget.text}</span>
        </p>
        <SettingsButton disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? t("settings.personalization.saving") : t("settings.personalization.save")}
          {/* 逐键帽渲染：join 在 Windows 上会拼出 "CtrlS" 一整块。 */}
          {!saving && saveKeys && (
            <KbdGroup className="ml-0.5">
              {saveKeys.map((glyph) => <Kbd key={glyph}>{glyph}</Kbd>)}
            </KbdGroup>
          )}
        </SettingsButton>
      </div>
    </>
  );
}

type Translate = ReturnType<typeof useAppTranslation>["t"];
function errorCopy(t: Translate, code: AgentInstructionsErrorCode) {
  const keys: Record<AgentInstructionsErrorCode, string> = {
    conflict: "settings.personalization.errors.conflict",
    "too-large": "settings.personalization.errors.tooLarge",
    "oversized-file": "settings.personalization.errors.oversizedFile",
    "symlink-unresolvable": "settings.personalization.errors.symlinkUnresolvable",
    "read-failed": "settings.personalization.errors.readFailed",
    "write-failed": "settings.personalization.errors.writeFailed",
  };
  return t(keys[code]);
}
