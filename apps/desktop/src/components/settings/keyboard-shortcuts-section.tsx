/**
 * [INPUT]: Depends on React, lucide TriangleAlert/Pencil/RotateCcw/Trash2, lib/shortcuts (truth table, resolver, capture, conflicts, glyphs), lib/settings-store (overrides persistence), lib/platform, settings-layout primitives, ui Button/Kbd/Tooltip, cn and i18n
 * [OUTPUT]: Provides KeyboardShortcutsSection (7 rows: read-only keycap display, pencil recorder, disabled pill beside the name, always-present disable button, reset/restore-defaults, conflict warning tips)
 * [POS]: The Settings › Keyboard shortcuts control surface; owns recorder interaction state only — bindings truth lives in lib/shortcuts defaults ⊕ settings.json overrides, writes go through settingsStore functional mutations
 */

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Pencil, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Kbd, KbdGroup } from "@ai-chat/ui/components/ui/kbd";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsButton,
  SettingsList,
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
  const [recording, setRecording] = useState(false);

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
      badge={binding ? undefined : <DisabledPill />}
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
          <BindingDisplay id={id} binding={binding} recording={recording} />
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
          <RecorderButton
            id={id}
            label={label}
            busy={busy}
            recording={recording}
            onRecordingChange={setRecording}
            onReject={setRejected}
            onCapture={(next) => {
              setRejected(null);
              void persist(next);
            }}
          />
          {/* 停用钮常驻，无绑定时置灰而不是消失：可做与不可做用
              disabled 说，用「有没有」说的代价是尾部图标列随状态
              左右横跳，相邻行的同一个动作落不到同一条竖线上。 */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("settings.shortcuts.disableAria", { name: label })}
            disabled={busy || !binding}
            onClick={() => {
              setRejected(null);
              void persist(null);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      }
    />
  );
}

/* ============================================================
 * 键帽是只读的事实陈述：显示当前绑定，不接受点击，静止态连边框
 * 都不留。可点的形状全部让给右边那两颗图标钮——界面因此不再暗示
 * 一个不存在的输入框，也不必再解释「为什么这里点了也能改」。
 *
 * 唯一的例外是录制态：这时它套上一圈 ring 与底色。边框只在它携带
 * 信息时出现——「我正在听键」——而不是常年挂在那里冒充控件。
 *
 * 停用档这里是空的：没有键就没有键帽。判词交给名字旁的徽标去说，
 * min-w-24 只留住列宽，好让七行的键帽落在同一条竖线上。
 * ============================================================ */
function BindingDisplay({
  id,
  binding,
  recording,
}: {
  id: ShortcutId;
  binding: ShortcutBinding | null;
  recording: boolean;
}) {
  const { t } = useAppTranslation();
  return (
    <span
      data-testid={`shortcut-keys-${id}`}
      className={cn(
        "flex h-8 min-w-24 items-center justify-center rounded-md px-2.5 text-xs",
        recording && "bg-muted/60 ring-1 ring-ring/40"
      )}
    >
      {recording ? (
        <span className="text-muted-foreground">
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
      ) : null}
    </span>
  );
}

/* 停用是用户按下的一个决定，不是错误：实心中性药丸，读得见但不报警。
   琥珀色在这一页已被冲突占用，一色两义会把两种状态搅成一种噪音。 */
function DisabledPill() {
  const { t } = useAppTranslation();
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-foreground/10 px-2 font-medium text-[11px] text-foreground leading-none">
      {t("settings.shortcuts.disabled")}
    </span>
  );
}

/* ============================================================
 * 录制器就是那颗铅笔：点击进入录制态，随后吃下一切 keydown——
 * preventDefault + stopPropagation 双保险，window 级分派器
 * （useGlobalShortcuts、聊天查找）在录制期一个键也收不到。
 * 两个例外：Escape 取消（仍吞掉），Tab 取消但放行——键盘用户
 * 得能离开这颗按钮。失焦即取消：录制态不允许在视野外滞留。
 * 录制中按 ⌘Q 会退出应用：隐式菜单在 renderer 之前吃键，无菜单
 * 手术不可避免，保留键表只能拦住到得了这里的组合。
 *
 * aria-pressed 把它说成一个开关：键帽的变身只对眼睛说话，读屏
 * 用户得从按钮本身听见自己进没进录制态。
 * ============================================================ */
function RecorderButton({
  id,
  label,
  busy,
  recording,
  onRecordingChange,
  onReject,
  onCapture,
}: {
  id: ShortcutId;
  label: string;
  busy: boolean;
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  onReject: (reason: RejectReason | null) => void;
  onCapture: (binding: ShortcutBinding) => void;
}) {
  const { t } = useAppTranslation();

  const stop = () => onRecordingChange(false);

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
      variant="ghost"
      size="icon-sm"
      aria-label={t("settings.shortcuts.editAria", { name: label })}
      aria-pressed={recording}
      disabled={busy}
      className={cn(recording && "bg-muted text-foreground")}
      onClick={() => {
        if (!recording) onReject(null);
        onRecordingChange(!recording);
      }}
      onKeyDown={onKeyDown}
      onBlur={stop}
    >
      <Pencil />
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
