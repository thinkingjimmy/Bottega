/**
 * [INPUT]: Depends on React, lucide TriangleAlert/RotateCcw/Trash2, lib/shortcuts (truth table, resolver, capture, conflicts, glyphs), lib/settings-store (overrides persistence), lib/platform, settings-layout primitives, ui Button/Kbd/Tooltip and i18n
 * [OUTPUT]: Provides KeyboardShortcutsSection (7 rebindable rows: record/disable/reset/restore-defaults, conflict warning tips) and EditorKeysSection (read-only composer keys via SettingsNoteList)
 * [POS]: The Settings › Keyboard shortcuts control surface; owns recorder interaction state only — bindings truth lives in lib/shortcuts defaults ⊕ settings.json overrides, writes go through settingsStore functional mutations
 */

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Kbd, KbdGroup } from "@ai-chat/ui/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsButton,
  SettingsList,
  SettingsNoteList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { isApplePlatform } from "@/lib/platform";
import { settingsStore } from "@/lib/settings-store";
import {
  bindingGlyphs,
  captureBinding,
  conflictingShortcutIds,
  SHORTCUT_IDS,
  useShortcutBindings,
  type CaptureResult,
  type ShortcutBinding,
  type ShortcutId,
} from "@/lib/shortcuts";

/* 作用域说明只有互斥页面的三行需要：全局快捷键无需自我介绍。 */
const SCOPE_HINT_IDS = new Set<ShortcutId>([
  "saveInstructions",
  "findInFile",
  "findInChat",
]);

type RejectReason = Extract<CaptureResult, { kind: "reject" }>["reason"];

export function KeyboardShortcutsSection() {
  const { t } = useAppTranslation();
  const bindings = useShortcutBindings();
  const snapshot = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  useEffect(() => settingsStore.ensureLoaded(), []);
  const overrides = snapshot.settings?.keyboardShortcuts;
  const conflicts = useMemo(
    () => conflictingShortcutIds(bindings),
    [bindings]
  );
  const hasOverrides = Object.keys(overrides ?? {}).length > 0;

  return (
    <SettingsSection
      title={t("settings.shortcuts.title")}
      description={t("settings.shortcuts.description")}
      alert={snapshot.error}
      action={
        <SettingsButton
          variant="outline"
          disabled={!hasOverrides}
          onClick={() =>
            void settingsStore.update(
              { keyboardShortcuts: {} },
              t("settings.shortcuts.restoreFailed")
            )
          }
        >
          {t("settings.shortcuts.restoreDefaults")}
        </SettingsButton>
      }
    >
      <SettingsList>
        {SHORTCUT_IDS.map((id) => (
          <ShortcutRow
            key={id}
            id={id}
            binding={bindings[id]}
            overridden={overrides?.[id] !== undefined}
            conflictIds={conflicts.get(id)}
          />
        ))}
      </SettingsList>
    </SettingsSection>
  );
}

function ShortcutRow({
  id,
  binding,
  overridden,
  conflictIds,
}: {
  id: ShortcutId;
  binding: ShortcutBinding | null;
  overridden: boolean;
  conflictIds: ShortcutId[] | undefined;
}) {
  const { t } = useAppTranslation();
  const label = t(`settings.shortcuts.labels.${id}`);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<RejectReason | null>(null);

  /* undefined=清覆写（回默认），null=停用，binding=改绑。函数式 mutation
     让并发改绑在 revision 队列上合并，而不是互相覆盖。 */
  const persist = async (value: ShortcutBinding | null | undefined) => {
    setBusy(true);
    try {
      await settingsStore.update((current) => {
        const next = { ...current.keyboardShortcuts };
        if (value === undefined) delete next[id];
        else next[id] = value;
        return { keyboardShortcuts: next };
      }, t("settings.shortcuts.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const rejectionCopy =
    rejected &&
    t(`settings.shortcuts.errors.${rejected}`, {
      mod: isApplePlatform() ? "⌘" : "Ctrl",
    });

  return (
    <SettingsRow
      label={label}
      htmlFor={`shortcut-${id}`}
      description={
        SCOPE_HINT_IDS.has(id) || rejectionCopy ? (
          <>
            {SCOPE_HINT_IDS.has(id) && t(`settings.shortcuts.hints.${id}`)}
            {rejectionCopy && (
              <span role="alert" className="block text-destructive">
                {rejectionCopy}
              </span>
            )}
          </>
        ) : undefined
      }
      control={
        <div className="flex items-center gap-1.5">
          {conflictIds && (
            <ConflictTip
              text={t("settings.shortcuts.conflictWith", {
                name: conflictIds
                  .map((other) => t(`settings.shortcuts.labels.${other}`))
                  .join(", "),
              })}
            />
          )}
          <RecorderButton
            id={id}
            label={label}
            binding={binding}
            busy={busy}
            onReject={setRejected}
            onCapture={(next) => {
              setRejected(null);
              void persist(next);
            }}
          />
          {overridden && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("settings.shortcuts.resetAria", { name: label })}
              disabled={busy}
              onClick={() => {
                setRejected(null);
                void persist(undefined);
              }}
            >
              <RotateCcw />
            </Button>
          )}
          {binding && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("settings.shortcuts.disableAria", { name: label })}
              disabled={busy}
              onClick={() => {
                setRejected(null);
                void persist(null);
              }}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      }
    />
  );
}

/* ============================================================
 * 录制器是一颗会变身的按钮：静止态展示键帽（或「已停用」），点击进入
 * 录制态吃下一切 keydown——preventDefault + stopPropagation 双保险，
 * window 级分派器（useGlobalShortcuts、聊天查找）在录制期一个键也
 * 收不到。两个例外：Escape 取消（仍吞掉），Tab 取消但放行——键盘
 * 用户得能离开这颗按钮。失焦即取消：录制态不允许在视野外滞留。
 * 录制中按 ⌘Q 会退出应用：隐式菜单在 renderer 之前吃键，无菜单
 * 手术不可避免，保留键表只能拦住到得了这里的组合。
 * ============================================================ */
function RecorderButton({
  id,
  label,
  binding,
  busy,
  onReject,
  onCapture,
}: {
  id: ShortcutId;
  label: string;
  binding: ShortcutBinding | null;
  busy: boolean;
  onReject: (reason: RejectReason | null) => void;
  onCapture: (binding: ShortcutBinding) => void;
}) {
  const { t } = useAppTranslation();
  const [recording, setRecording] = useState(false);

  const stop = () => setRecording(false);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    if (event.key === "Tab") {
      stop();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stop();
      return;
    }
    const result = captureBinding(event.nativeEvent);
    if (result.kind === "pending") return;
    if (result.kind === "reject") {
      onReject(result.reason);
      return;
    }
    stop();
    onCapture(result.binding);
  };

  return (
    <Button
      id={`shortcut-${id}`}
      type="button"
      variant="outline"
      size="lg"
      aria-label={t("settings.shortcuts.editAria", { name: label })}
      disabled={busy}
      className="min-w-24 cursor-pointer justify-center px-2.5"
      onClick={() => {
        if (!recording) onReject(null);
        setRecording((value) => !value);
      }}
      onKeyDown={onKeyDown}
      onBlur={stop}
    >
      {recording ? (
        <span className="text-muted-foreground text-xs">
          {t("settings.shortcuts.recordingPlaceholder")}
          <span className="ml-1.5 text-muted-foreground/60">
            {t("settings.shortcuts.recordingHint")}
          </span>
        </span>
      ) : binding ? (
        <KbdGroup>
          {bindingGlyphs(binding).map((glyph) => (
            <Kbd key={glyph}>{glyph}</Kbd>
          ))}
        </KbdGroup>
      ) : (
        <span className="text-muted-foreground">
          {t("settings.shortcuts.disabled")}
        </span>
      )}
    </Button>
  );
}

/* 警告贴在冲突的那一行旁边；role="img" + aria-label 让读屏把冲突
   对象并入行内容播报。同 UsageInfoTip 的形状，换 TriangleAlert。 */
function ConflictTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={text}
          data-testid="shortcut-conflict"
          className="inline-flex shrink-0 cursor-help text-amber-600 dark:text-amber-500"
        >
          <TriangleAlert className="size-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/* ============================================================
 * 编辑器按键是只读事实：没有东西可点，按房规走 SettingsNoteList
 * 而不是右侧空着的 SettingsRow。键名是平台字形不是文案，由代码
 * 按惯例拼（mac 无连接号、其余用 +），不进 i18n 目录。
 * ============================================================ */
export function EditorKeysSection() {
  const { t } = useAppTranslation();
  const apple = isApplePlatform();
  const items = [
    { term: "Enter", detail: t("settings.shortcuts.editor.send") },
    {
      term: apple ? "⇧ Enter" : "Shift + Enter",
      detail: t("settings.shortcuts.editor.newline"),
    },
    {
      term: apple ? "⌘ Z · ⇧ ⌘ Z · ⌘ Y" : "Ctrl + Z · Ctrl + Shift + Z · Ctrl + Y",
      detail: t("settings.shortcuts.editor.undo"),
    },
  ];
  return (
    <SettingsSection
      title={t("settings.shortcuts.editorTitle")}
      description={t("settings.shortcuts.editorDescription")}
    >
      <SettingsNoteList items={items} />
    </SettingsSection>
  );
}
