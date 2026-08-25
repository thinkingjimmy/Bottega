/**
 * [INPUT]: Depends on React, Unified Skills client/shared DTO, i18n, PageShell, Settings, Settings, Skills, and skill-text
 * [OUTPUT]: Provides SkillsSettingsView: Library space is reading only, library space is scanning + diagnostics, library space is open on the ground, there are no more bullet windows, extra unread instructions, unread findings, take-over authorization and read-only degradation; single SkillPending owner (changed broadcasts never touch it), one refresh definition (snapshot + open candidate sheet rebuilt) shared by the Refresh button and automatic conflict recovery, per-button import spinners via `importing`
 * [POS]: The only main page of Settings › Skills; In order to sort the file in order by process, see renderer-safe ref/code, without touching the path
 */

import { useEffect, useState } from "react";
import { LoaderCircle, Plus, RefreshCw, Search, Sparkles } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsDisclosure,
  SettingsList,
  SettingsSection,
} from "@/components/settings/settings-layout";
import {
  SkillImportPanel,
  type SkillImportResult,
} from "@/components/settings/skills/skill-import-panel";
import { SkillLibraryRow } from "@/components/settings/skills/skill-library-row";
import {
  SkillFirstRun,
  SkillUnmanagedNotice,
} from "@/components/settings/skills/skill-sources";
import {
  SKILL_AGENTS,
  skillErrorCode,
  skillErrorText,
  skillReasonText,
} from "@/components/settings/skills/skill-text";
import {
  applyUnifiedSkillAction,
  authorizeUnifiedSkillAction,
  dismissUnifiedSkillsOnboarding,
  importUnifiedSkills,
  listUnifiedSkillCandidates,
  listUnifiedSkills,
  onUnifiedSkillsChanged,
  previewUnifiedSkillAction,
  setUnifiedCodexProduct,
} from "@/lib/unified-skills-client";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import type {
  ManagedSkillAction,
  ManagedSkillActionPreview,
  ManagedSkillAgent,
  ManagedSkillImportPreview,
  ManagedSkillLibraryItem,
  ManagedSkillTargetView,
  ManagedSkillVisibility,
  UnifiedSkillsSnapshot,
} from "../../shared/unified-skills-ipc";

const NO_CANDIDATES = { codex: 0, claude: 0, kimi: 0, opencode: 0 } as const;
/* import() 一次最多收 512 个 ref；超出的那批留给下一轮，不静默丢。 */
const IMPORT_BATCH = 512;

/* 一个状态回答两个问题：忙不忙（非空）、谁在忙（值）。从前这是颗布尔，
   于是「导入所选」与「全部导入」没法各自亮起自己的进行中指示。 */
type SkillPending = "source" | "import" | "import-all" | "action" | "product" | "dismiss" | null;

const importableRefs = (preview: ManagedSkillImportPreview) =>
  new Set(preview.candidates.filter((item) => item.importable).map((item) => item.ref));

export function SkillsSettingsView() {
  const { t } = useAppTranslation();
  const [snapshot, setSnapshot] = useState<UnifiedSkillsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<SkillPending>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [openAgent, setOpenAgent] = useState<ManagedSkillAgent | null>(null);
  const [importPreview, setImportPreview] = useState<ManagedSkillImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<SkillImportResult | null>(null);
  /* 库非空时入库面是收着的；库空时它就是第 1 步本身，没有收起这一说。 */
  const [panelOpen, setPanelOpen] = useState(false);
  const [action, setAction] = useState<ManagedSkillActionPreview | null>(null);
  const busy = pending !== null;

  /* ── 「刷新」只有一个定义 ────────────────────────────────────────
   * 重扫快照；候选表若开着，连它一起重建（默认全选）。分组标题旁那颗
   * Refresh 与 conflict 自动恢复走的是同一条路。从前 Refresh 只换快照
   * 不换已展开的候选表：报错文案让人「刷新后重试」，人照做了，屏幕上
   * 的旧候选却原样提交，重试永远失败——那是一条走不出去的路。 */
  const refresh = async () => {
    setLoading(true);
    try {
      setSnapshot(await listUnifiedSkills(true));
      if (openAgent) {
        const preview = await listUnifiedSkillCandidates(openAgent);
        setImportPreview(preview);
        setSelected(importableRefs(preview));
      }
    } catch (cause) { setError(skillErrorText(t, cause)); }
    finally { setLoading(false); }
  };

  /* conflict = 屏幕上的事实过时了。文案承诺「清单已自动刷新」，这里兑现：
     把「刷新」那一步从用户手里拿回来，重试才有机会成功。 */
  const fail = async (cause: unknown) => {
    setError(skillErrorText(t, cause));
    if (skillErrorCode(cause) === "conflict") await refresh();
  };

  useEffect(() => {
    let live = true;
    void listUnifiedSkills().then(
      (next) => { if (live) { setSnapshot(next); setLoading(false); } },
      (cause) => { if (live) { setError(skillErrorText(t, cause)); setLoading(false); } }
    );
    /* changed 广播只带来新快照。pending 归发起操作的 finally 管——
       广播若插手，进行中的批量导入会在半路被解禁成可再点。 */
    const unsubscribe = onUnifiedSkillsChanged((next) => {
      if (live) setSnapshot(next);
    });
    return () => { live = false; unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collapse = () => { setOpenAgent(null); setImportPreview(null); setSelected(new Set()); };

  /* 展开一家来源就是取一次候选：来源是这张表的一个维度，不是一扇门。
     再点同一行就收起——收起就是退出，所以这里没有「取消」。 */
  const openSource = async (agent: ManagedSkillAgent | null) => {
    if (!agent) { collapse(); return; }
    setPending("source");
    setError("");
    setResult(null);
    try {
      /* 不强制重扫：发现是后台的事，页面上的数字与这份缓存同源。
         真要重扫有分组标题旁那颗 Refresh，它才是显式的那一下。 */
      const preview = await listUnifiedSkillCandidates(agent);
      setOpenAgent(agent);
      setImportPreview(preview);
      setSelected(importableRefs(preview));
    } catch (cause) { await fail(cause); }
    finally { setPending(null); }
  };

  const applyImport = async () => {
    if (!importPreview) return;
    setPending("import");
    setError("");
    try {
      setSnapshot(await importUnifiedSkills({
        previewId: importPreview.previewId,
        revision: importPreview.revision,
        candidateRefs: [...selected],
      }));
      setResult({ imported: selected.size, skipped: 0 });
      /* 导入一旦落地，库就从空变成非空，首屏三段流程整块换成库视图——
         结果条要是跟着一起消失，人只看见界面变了，看不见发生了什么。 */
      setPanelOpen(true);
      collapse();
    } catch (cause) { await fail(cause); }
    finally { setPending(null); }
  };

  /* ── 一键全部：界面一颗按钮，底下按 SKILL_AGENTS 顺序四次预览 + 四次提交
   * candidates(agent) 一次只给一家，import() 一个 previewId 只提交一家，
   * 所以「全部」在 IPC 上不是一个新动作，是四次旧动作——一行协议都不用改。
   *
   * 顺序有意义：先导 Codex，Claude 那几个同名的在下一次预览里就已经带上
   * name-taken 落进「收不进来」，于是 409 不会发生，跳过几个也说得出口。
   * ──────────────────────────────────────────────────────────────── */
  const importAll = async () => {
    setPending("import-all");
    setError("");
    setResult(null);
    collapse();
    let imported = 0;
    let skipped = 0;
    try {
      for (const agent of SKILL_AGENTS) {
        const preview = await listUnifiedSkillCandidates(agent);
        const importable = preview.candidates.filter((item) => item.importable);
        skipped += preview.candidates.filter((item) => item.reason?.code === "name-taken").length;
        if (!importable.length) continue;
        const refs = importable.slice(0, IMPORT_BATCH).map((item) => item.ref);
        setSnapshot(await importUnifiedSkills({
          previewId: preview.previewId,
          revision: preview.revision,
          candidateRefs: refs,
        }));
        imported += refs.length;
      }
      setResult({ imported, skipped });
      setPanelOpen(true);
    } catch (cause) { await fail(cause); }
    finally { setPending(null); }
  };

  const beginAction = async (
    skill: ManagedSkillLibraryItem,
    target: ManagedSkillTargetView,
    requested: ManagedSkillAction
  ) => {
    if (!snapshot) return;
    setPending("action");
    setError("");
    try {
      setAction(await previewUnifiedSkillAction({
        skillRef: skill.ref,
        agent: target.agent,
        action: requested,
        expectedRevision: snapshot.revision,
      }));
    } catch (cause) { await fail(cause); }
    finally { setPending(null); }
  };

  const applyAction = async () => {
    if (!action) return;
    setPending("action");
    setError("");
    try {
      const authority = await authorizeUnifiedSkillAction(action.previewId);
      setSnapshot(await applyUnifiedSkillAction({
        previewId: action.previewId,
        authorityToken: authority.authorityToken,
        expectedRevision: action.expectedRevision,
      }));
    } catch (cause) { await fail(cause); }
    finally { setAction(null); setPending(null); }
  };

  const setProduct = async (skill: ManagedSkillLibraryItem, enabled: boolean) => {
    if (!snapshot) return;
    setPending("product");
    setError("");
    try {
      setSnapshot(await setUnifiedCodexProduct({ skillRef: skill.ref, enabled, expectedRevision: snapshot.revision }));
    } catch (cause) { await fail(cause); }
    finally { setPending(null); }
  };

  const dismiss = async () => {
    setPending("dismiss");
    try { setSnapshot(await dismissUnifiedSkillsOnboarding()); }
    catch (cause) { await fail(cause); }
    finally { setPending(null); }
  };

  const readOnly = snapshot?.availability.kind === "read-only";
  const counts = snapshot?.candidates.unmanagedByAgent ?? NO_CANDIDATES;
  const bytes = snapshot?.candidates.unmanagedBytes ?? 0;
  const library = snapshot?.library ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? library.filter((skill) => `${skill.displayName} ${skill.description}`.toLowerCase().includes(needle))
    : library;
  /* 「查看未纳管」指向存量最多的那一家——从前它硬编码 codex，
     文案却只说「查看现有 Skills」，按钮做的和说的不是一件事。 */
  const leadSource = [...SKILL_AGENTS].sort((left, right) => counts[right] - counts[left])[0]!;
  const errors = snapshot?.candidates.errors ?? [];
  /* 库空时入库面就是第 1 步的身体，没有开合可言。 */
  const showPanel = !library.length || panelOpen;

  const togglePanel = () => {
    if (panelOpen) { setPanelOpen(false); collapse(); return; }
    setPanelOpen(true);
    setResult(null);
  };

  const importPanel = (
    <SkillImportPanel
      busy={busy || readOnly}
      bytes={bytes}
      counts={counts}
      importing={pending === "import" ? "selected" : pending === "import-all" ? "all" : null}
      onImport={() => void applyImport()}
      onImportAll={() => void importAll()}
      onOpen={(agent) => void openSource(agent)}
      onSelected={setSelected}
      openAgent={openAgent}
      preview={importPreview}
      result={result}
      selected={selected}
    />
  );

  return (
    <PageShell icon={<Sparkles />} title={t("common.skills")}>
      <SettingsCanvas>
        <div className="space-y-8">
          <SettingsSection
            title={t("settings.skills.catalog")}
            description={library.length
              ? t("settings.skills.librarySummary", { count: library.length })
              : t("settings.skills.description")}
            alert={error || (snapshot?.availability.kind === "read-only"
              ? `${t("settings.skills.readOnly")}: ${skillReasonText(t, snapshot.availability.reason)}`
              : undefined)}
            action={library.length ? (
              <div className="flex items-center gap-2">
                <div className="relative w-[11rem]">
                  <Search aria-hidden="true" className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    aria-label={t("settings.skills.search", { count: library.length })}
                    className="h-8 pl-8"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("settings.skills.search", { count: library.length })}
                    value={query}
                  />
                </div>
                {/* 从前这里是一颗下拉，里面又列一遍四家——同一个维度的第三个
                    控件。现在它只管开合那块入库面，选哪一家由面里的行说了算；
                    outline 变体自带 aria-expanded 的按下态，不必另画一种。 */}
                <SettingsButton
                  aria-expanded={panelOpen}
                  disabled={busy || readOnly}
                  onClick={togglePanel}
                  variant="outline"
                >
                  <Plus />{t("settings.skills.import")}
                </SettingsButton>
                <SettingsButton
                  aria-label={t("settings.skills.refresh")}
                  disabled={loading}
                  onClick={() => { setError(""); void refresh(); }}
                  variant="outline"
                >
                  <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
                </SettingsButton>
              </div>
            ) : undefined}
          >
            <div className="space-y-4">
              {loading && !snapshot ? (
                <p className="flex items-center gap-2 py-8 text-muted-foreground text-sm" role="status">
                  <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{t("settings.skills.loading")}
                </p>
              ) : library.length ? (
                /* 入库面与库列表之间用 32px——本仓分组之间的 space-y-8，
                   「另一件事」的房规尺寸，不必再添一道线。 */
                <div className="flex flex-col gap-8">
                  {showPanel ? (
                    <div>
                      <p className="mb-2.5 text-muted-foreground text-xs leading-relaxed">
                        {t("settings.skills.step.importDetail")}
                      </p>
                      {importPanel}
                    </div>
                  ) : snapshot?.onboarding.visible ? (
                    <SkillUnmanagedNotice
                      busy={busy}
                      codexUnmanaged={snapshot.onboarding.codexUnmanaged}
                      onDismiss={() => void dismiss()}
                      onReview={() => { setPanelOpen(true); setResult(null); void openSource(leadSource); }}
                      total={snapshot.onboarding.totalUnmanaged}
                    />
                  ) : null}
                  {shown.length ? (
                    <SettingsList>
                      {shown.map((skill) => (
                        <SkillLibraryRow
                          busy={busy || readOnly}
                          key={skill.ref}
                          onAction={beginAction}
                          onProduct={setProduct}
                          skill={skill}
                        />
                      ))}
                    </SettingsList>
                  ) : (
                    <p className="py-8 text-center text-muted-foreground text-sm">{t("settings.skills.noMatches")}</p>
                  )}
                </div>
              ) : (
                <SkillFirstRun>{importPanel}</SkillFirstRun>
              )}

              {/* 读不出的发现项是发现流程的副产品事实，不是谁操作失败了：
                  它折叠在这里，用的是中性色，而不是一片永远消不掉的红。 */}
              {errors.length > 0 && (
                <SettingsDisclosure label={t("settings.skills.errorsSummary", { count: errors.length })}>
                  <ul className="space-y-1">
                    {errors.map((item, index) => (
                      <li className="text-[11px] text-muted-foreground leading-relaxed" key={`${item.agent}:${item.label}:${index}`}>
                        <span className="text-foreground">{t(`settings.skills.backend.${item.agent}`)} · {item.label}</span>
                        {" — "}
                        {skillReasonText(t, item.reason)}
                      </li>
                    ))}
                  </ul>
                </SettingsDisclosure>
              )}
            </div>
          </SettingsSection>
        </div>
      </SettingsCanvas>

      <ConfirmationDialog
        busy={busy}
        confirmLabel={t("settings.skills.confirmAction")}
        description={action && (
          <div className="space-y-3">
            <p>{t(`settings.skills.confirm${capitalize(action.action)}`, { name: action.skillName, agent: t(`settings.skills.backend.${action.agent}`) })}</p>
            <p>{t(`settings.skills.warning.${action.warning}`)}</p>
            <p className="text-xs">{visibilityText(action.visibleTo, t)}</p>
          </div>
        )}
        onConfirm={() => void applyAction()}
        onOpenChange={(open) => { if (!open && !busy) setAction(null); }}
        open={Boolean(action)}
        title={t("settings.skills.confirmTitle")}
      />
    </PageShell>
  );
}

function visibilityText(
  visibleTo: readonly ManagedSkillVisibility[],
  t: (key: string, options?: Record<string, unknown>) => string
) {
  return t("settings.skills.visibility", {
    agents: visibleTo
      .map((item) => `${t(`settings.skills.backend.${item.agent}`)} (${t(`settings.skills.surface.${item.surface}`)})`)
      .join(", "),
  });
}

function capitalize(action: ManagedSkillAction) {
  return `${action[0]!.toUpperCase()}${action.slice(1)}`;
}
