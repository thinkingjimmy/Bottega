"use client";

/**
 * [INPUT]: Depends on React contenteditable, RichInput Public type, PromptInput RichValue, share context on UI documentation with the pure document model/historical rules
 * [OUTPUT]: Provides RichInput and public type; beforeinput/IME supports atomic chips, undo/redo, multi-trigger grouping and single-flight asynchronous consume
 * [POS]: The state machine for editing the rich text of ai-elements; Type, candidate projection, node DOM and IME to fit the submerged brother modules respectively
 */

import { cn } from "@ai-chat/ui/lib/utils";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import { readRichEditor, readRichRange } from "@ai-chat/ui/lib/rich-input-dom";
import { discardedRichNodes } from "@ai-chat/ui/lib/rich-input-history";
import {
  normalizeRichValue,
  normalizeSuggestionIndex,
  pointAtRichOffset,
  projectRichSuggestions,
  replaceRichRange,
  richValueLength,
  richQueryAtPoint,
  type RichCaretPoint,
  type RichQuery,
  type RichRange,
} from "@ai-chat/ui/lib/rich-input-model";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { RichNode, RichValue } from "./prompt-input";
import {
  DEFAULT_SUGGESTION_COPY,
  suggestionEditorAria,
  SuggestionMenu,
} from "./rich-input-suggestions";
import { RichInputNodes } from "./rich-input-nodes";
import { useRichInputComposition } from "./rich-input-composition";
import {
  cloneValue,
  isThenable,
  newText,
  pasteRichPlainText,
  placeCaret,
  sameEditorValue,
  sameValue,
  selectionInside,
  selectionPoint,
  type RichSuggestionTransaction,
} from "./rich-input-editor";
import type {
  RichInputHandle,
  RichInputProps,
  RichInputSuggestion,
} from "./rich-input-types";

export { PathLabel } from "./rich-input-suggestions";
export type {
  RichInputHandle,
  RichInputProps,
  RichInputSuggestion,
  RichSuggestionCopy,
} from "./rich-input-types";

export const RichInput = forwardRef<RichInputHandle, RichInputProps>(
  function RichInput(
    {
      value,
      onChange,
      onNodeDiscarded,
      onFileClick,
      onWorkspaceFileClick,
      onSuggestionSelect,
      onSuggestionPendingChange,
      fileClickTitle,
      workspaceFileClickTitle,
      suggestions = [],
      suggestionCopy,
      onQueryChange,
      renderSectionIcon,
      disabled = false,
      placeholder,
      className,
    },
    ref
  ) {
    const messageLabel = useUiText("message", "Message");
    const loadingLabel = useUiText("loading", "Loading");
    const resolvedPlaceholder = placeholder ?? messageLabel;
    const editorRef = useRef<HTMLDivElement>(null);
    const valueRef = useRef(value);
    const queryRef = useRef<RichQuery | null>(null);
    const savedPoint = useRef<RichCaretPoint | null>(null);
    const pendingPoint = useRef<RichCaretPoint | null>(null);
    const composing = useRef(false);
    const composition = useRef<{
      base: RichValue;
      range: RichRange;
    } | null>(null);
    const committedComposition = useRef<string | null>(null);
    const emittedValue = useRef<RichValue | null>(null);
    const history = useRef<RichValue[]>([cloneValue(value)]);
    const historyIndex = useRef(0);
    const onNodeDiscardedRef = useRef(onNodeDiscarded);
    const onQueryChangeRef = useRef(onQueryChange);
    const onSuggestionPendingChangeRef = useRef(onSuggestionPendingChange);
    const pendingSuggestionRef = useRef<RichSuggestionTransaction | null>(null);
    const nextSuggestionTransactionId = useRef(0);
    const [editorEpoch, setEditorEpoch] = useState(0);
    const [query, setQuery] = useState<RichQuery | null>(null);
    const [suggestionListId, setSuggestionListId] = useState<string>();
    const [preview, setPreview] = useState<{
      active: boolean;
      query: RichQuery | null;
    }>({ active: false, query: null });
    const [selected, setSelected] = useState(0);
    const [activeOptionId, setActiveOptionId] = useState<string>();
    const [suggestionPending, setSuggestionPending] = useState(false);
    valueRef.current = value;
    onNodeDiscardedRef.current = onNodeDiscarded;
    onQueryChangeRef.current = onQueryChange;
    onSuggestionPendingChangeRef.current = onSuggestionPendingChange;

    useEffect(
      () => () => {
        if (!pendingSuggestionRef.current) return;
        pendingSuggestionRef.current = null;
        onSuggestionPendingChangeRef.current?.(false);
      },
      []
    );

    const updateQuery = useCallback((next: RichQuery | null) => {
      queryRef.current = next;
      setQuery(next);
    }, []);

    useLayoutEffect(() => {
      if (!disabled) return;
      composing.current = false;
      composition.current = null;
      setPreview({ active: false, query: null });
      updateQuery(null);
    }, [disabled, updateQuery]);

    const effectiveQuery = disabled
      ? null
      : preview.active
        ? preview.query
        : query;
    const defaults = effectiveQuery
      ? DEFAULT_SUGGESTION_COPY[effectiveQuery.kind]
      : DEFAULT_SUGGESTION_COPY.mention;
    const copy = useMemo(
      () => ({
        ...defaults,
        ...suggestionCopy?.[effectiveQuery?.kind ?? "mention"],
      }),
      [defaults, effectiveQuery?.kind, suggestionCopy]
    );
    const projection = useMemo(
      () =>
        projectRichSuggestions({
          query: effectiveQuery,
          suggestions,
          groups: copy.groups,
        }),
      [copy.groups, effectiveQuery, suggestions]
    );
    const activeSuggestion = normalizeSuggestionIndex(
      selected,
      projection.flat.length
    );

    useLayoutEffect(() => {
      onQueryChangeRef.current?.(effectiveQuery);
    }, [effectiveQuery]);

    useLayoutEffect(() => {
      if (emittedValue.current === value) {
        emittedValue.current = null;
      } else {
        const previousHistory = history.current;
        const nextHistory = [cloneValue(value)];
        history.current = nextHistory;
        historyIndex.current = 0;
        for (const node of discardedRichNodes(previousHistory, nextHistory)) {
          onNodeDiscardedRef.current?.(node);
        }
      }
      const point = pendingPoint.current;
      const editor = editorRef.current;
      if (!point || !editor) return;
      pendingPoint.current = null;
      editor.focus();
      placeCaret(editor, point);
    }, [editorEpoch, value]);

    const apply = useCallback(
      (next: RichValue, point?: RichCaretPoint) => {
        const normalized = normalizeRichValue(next);
        if (!sameValue(valueRef.current, normalized)) {
          const previousHistory = history.current;
          const nextHistory = [
            ...previousHistory.slice(0, historyIndex.current + 1),
            cloneValue(normalized),
          ].slice(-100);
          history.current = nextHistory;
          historyIndex.current = nextHistory.length - 1;
          for (const node of discardedRichNodes(
            previousHistory,
            nextHistory
          )) {
            onNodeDiscardedRef.current?.(node);
          }
        }
        valueRef.current = normalized;
        if (point) pendingPoint.current = point;
        emittedValue.current = normalized;
        onChange(normalized);
      },
      [onChange]
    );

    const restoreHistory = useCallback(
      (direction: -1 | 1) => {
        const index = historyIndex.current + direction;
        const snapshot = history.current[index];
        if (!snapshot) return false;
        historyIndex.current = index;
        const next = cloneValue(snapshot);
        valueRef.current = next;
        emittedValue.current = next;
        const last = next.at(-1);
        pendingPoint.current =
          last?.type === "text"
            ? { index: next.length - 1, offset: last.value.length }
            : { index: next.length, offset: 0 };
        updateQuery(null);
        onChange(next);
        return true;
      },
      [onChange, updateQuery]
    );

    const insertPlainText = useCallback(
      (text: string, sourceRange?: RichRange) => {
        if (!text) return;
        const editor = editorRef.current;
        const current = valueRef.current;
        const end = richValueLength(current);
        const range = sourceRange ?? (editor ? readRichRange(editor) : null) ?? {
          start: end,
          end,
        };
        const replacement = replaceRichRange(current, range, text);
        const nextPoint = pointAtRichOffset(
          replacement.value,
          replacement.caret
        );
        updateQuery(richQueryAtPoint(replacement.value, nextPoint));
        setSelected(0);
        apply(replacement.value, nextPoint);
      },
      [apply, updateQuery]
    );

    const adoptNativeEditor = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const range = readRichRange(editor);
      const next = readRichEditor(editor, valueRef.current);
      const offset = range?.end ?? richValueLength(next);
      const unchanged = sameEditorValue(next, valueRef.current);
      const canonical = unchanged ? valueRef.current : next;
      const point = pointAtRichOffset(canonical, offset);
      setEditorEpoch((current) => current + 1);
      updateQuery(richQueryAtPoint(canonical, point));
      setSelected(0);
      if (unchanged) {
        pendingPoint.current = point;
        emittedValue.current = canonical;
      } else {
        apply(canonical, point);
      }
    }, [apply, updateQuery]);

    useLayoutEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const handleBeforeInput = (event: InputEvent) => {
        if (
          composing.current ||
          event.isComposing ||
          event.inputType === "insertCompositionText" ||
          event.inputType === "deleteCompositionText"
        ) {
          return;
        }
        if (
          event.inputType === "insertText" &&
          event.data !== null &&
          event.data === committedComposition.current
        ) {
          committedComposition.current = null;
          event.preventDefault();
          return;
        }
        if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
          event.preventDefault();
          restoreHistory(event.inputType === "historyUndo" ? -1 : 1);
          return;
        }
        if (event.inputType.startsWith("format")) {
          event.preventDefault();
          return;
        }
        const target = event.getTargetRanges()[0];
        const range = readRichRange(editor, target);
        if (event.inputType.startsWith("delete")) {
          event.preventDefault();
          const current = valueRef.current;
          const end = richValueLength(current);
          const selected = range ?? { start: end, end };
          let start = selected.start;
          let finish = selected.end;
          if (start === finish) {
            const units = current
              .map((node) => (node.type === "text" ? node.value : "\uFFFC"))
              .join("");
            if (event.inputType.endsWith("Forward")) {
              finish += [...units.slice(finish)][0]?.length ?? 0;
            } else {
              start -= [...units.slice(0, start)].at(-1)?.length ?? 0;
            }
          }
          const replacement = replaceRichRange(current, { start, end: finish }, "");
          const point = pointAtRichOffset(replacement.value, replacement.caret);
          updateQuery(null);
          apply(replacement.value, point);
          return;
        }
        let text: string | null = null;
        if (
          event.inputType === "insertLineBreak" ||
          event.inputType === "insertParagraph"
        ) {
          text = "\n";
        } else if (
          event.inputType === "insertText" ||
          event.inputType === "insertReplacementText" ||
          event.inputType === "insertTranspose"
        ) {
          text = event.data;
        } else if (
          event.inputType === "insertFromDrop" ||
          event.inputType === "insertFromPaste"
        ) {
          text = event.dataTransfer?.getData("text/plain") ?? event.data;
        }
        if (text !== null) {
          event.preventDefault();
          insertPlainText(text, range ?? undefined);
        }
      };
      editor.addEventListener("beforeinput", handleBeforeInput);
      return () => editor.removeEventListener("beforeinput", handleBeforeInput);
    }, [apply, editorEpoch, insertPlainText, restoreHistory, updateQuery]);

    const insertNode = useCallback(
      (node: Exclude<RichNode, { type: "text" }>) => {
        const current = valueRef.current;
        const editor = editorRef.current;
        const point = savedPoint.current ?? (editor ? selectionPoint(editor) : null) ?? {
          index: current.length,
          offset: 0,
        };
        const target = current[point.index];
        const next = [...current];
        let caretIndex = point.index + 1;
        if (target?.type === "text") {
          const before = target.value.slice(0, point.offset);
          const after = target.value.slice(point.offset);
          const replacement: RichValue = [
            ...(before ? [{ ...target, value: before }] : []),
            node,
            ...(after ? [newText(after)] : [newText("")]),
          ];
          next.splice(point.index, 1, ...replacement);
          caretIndex = point.index + replacement.length - 1;
        } else {
          next.splice(point.index, 0, node, newText(""));
          caretIndex = point.index + 1;
        }
        savedPoint.current = null;
        apply(next, { index: caretIndex, offset: 0 });
      },
      [apply]
    );

    /* contenteditable 的 focus() 把光标丢在最前，<textarea> 落在末尾——这是
       浏览器分歧，不是产品语义，适配器在此抹平。选择区还在编辑器里就是「回到
       原处」（Gallery 回流、菜单收起），原地不动；从外部进来才是「初次落点」，
       落到内容末尾——换会话重新挂载的草稿走的正是这条路。 */
    const focus = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const resuming = selectionInside(editor);
      editor.focus();
      if (resuming) return;
      placeCaret(
        editor,
        pointAtRichOffset(valueRef.current, richValueLength(valueRef.current))
      );
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus,
        saveSelection: () => {
          if (editorRef.current) savedPoint.current = selectionPoint(editorRef.current);
        },
        insertNode,
      }),
      [focus, insertNode]
    );

    const commitSuggestion = useCallback(
      (
        item: RichInputSuggestion,
        consumed = false,
        transaction?: RichSuggestionTransaction
      ) => {
        const activeQuery = transaction?.query ?? queryRef.current;
        if (!activeQuery) return;
        const current = valueRef.current;
        const index = current.findIndex(
          (node) => node.type === "text" && node.id === activeQuery.nodeId
        );
        const target = current[index];
        if (index < 0 || target?.type !== "text") return;
        if (transaction && target.value !== transaction.sourceValue) return;
        const before = target.value.slice(0, activeQuery.start);
        const triggerLength = activeQuery.value.length + 1;
        const token: RichNode =
          item.kind === "skill"
            ? {
                id: crypto.randomUUID(),
                type: "skill",
                ref: item.ref,
                name: item.name,
                label: item.label,
              }
            : item.kind === "section"
              ? {
                  id: crypto.randomUUID(),
                  type: "section",
                  chatId: item.chatId,
                  name: item.name,
                  agent: item.agent,
                }
              : item.kind === "history"
                ? {
                    id: crypto.randomUUID(),
                    type: "history",
                    opaqueId: item.opaqueId,
                    name: item.name,
                    agent: item.agent,
                  }
              : {
                  id: crypto.randomUUID(),
                  type: "workspace-file",
                  path: item.path,
                  entryKind: item.entryKind === "dir" ? "dir" : "file",
                };
        const replacement: RichValue = [
          ...(before ? [{ ...target, value: before }] : []),
          ...(consumed ? [] : [token]),
          newText(
            target.value.slice(activeQuery.start + triggerLength)
          ),
        ];
        const sameAtom = (node: RichNode) =>
          (item.kind === "section" && node.type === "section" && node.chatId === item.chatId) ||
          (item.kind === "history" && node.type === "history" && node.opaqueId === item.opaqueId);
        if (!consumed && (item.kind === "section" || item.kind === "history")) {
          const existingIndex = current.findIndex(sameAtom);
          if (existingIndex >= 0) {
            const withoutQuery = replaceRichRange(
              current,
              {
                start:
                  current
                    .slice(0, index)
                    .reduce(
                      (total, node) =>
                        total + (node.type === "text" ? node.value.length : 1),
                      0
                    ) + activeQuery.start,
                end:
                  current
                    .slice(0, index)
                    .reduce(
                      (total, node) =>
                        total + (node.type === "text" ? node.value.length : 1),
                      0
                    ) +
                  activeQuery.start +
                  triggerLength,
              },
              ""
            );
            updateQuery(null);
            const nextExistingIndex = withoutQuery.value.findIndex(sameAtom);
            apply(
              withoutQuery.value,
              {
                index: Math.max(0, nextExistingIndex + 1),
                offset: 0,
              }
            );
            return;
          }
        }
        updateQuery(null);
        apply(
          [...current.slice(0, index), ...replacement, ...current.slice(index + 1)],
          { index: index + replacement.length - 1, offset: 0 }
        );
      },
      [apply, updateQuery]
    );

    const chooseSuggestion = useCallback(
      (item: RichInputSuggestion) => {
        if (disabled || pendingSuggestionRef.current) return;
        if (!onSuggestionSelect) {
          commitSuggestion(item);
          return;
        }
        const activeQuery = queryRef.current;
        if (!activeQuery) return;
        const target = valueRef.current.find(
          (node) => node.type === "text" && node.id === activeQuery.nodeId
        );
        if (target?.type !== "text") return;
        const transaction: RichSuggestionTransaction = {
          id: ++nextSuggestionTransactionId.current,
          query: activeQuery,
          sourceValue: target.value,
        };
        let result: boolean | Promise<boolean>;
        try {
          result = onSuggestionSelect(item);
        } catch {
          commitSuggestion(item, false, transaction);
          return;
        }
        if (!isThenable(result)) {
          commitSuggestion(item, result, transaction);
          return;
        }
        pendingSuggestionRef.current = transaction;
        setSuggestionPending(true);
        onSuggestionPendingChangeRef.current?.(true);
        updateQuery(null);
        void Promise.resolve(result)
          .then((consumed) => {
            if (pendingSuggestionRef.current?.id !== transaction.id) return;
            commitSuggestion(item, consumed, transaction);
          })
          .catch(() => {
            if (pendingSuggestionRef.current?.id !== transaction.id) return;
            commitSuggestion(item, false, transaction);
          })
          .finally(() => {
            if (pendingSuggestionRef.current?.id !== transaction.id) return;
            pendingSuggestionRef.current = null;
            setSuggestionPending(false);
            onSuggestionPendingChangeRef.current?.(false);
          });
      },
      [commitSuggestion, disabled, onSuggestionSelect, updateQuery]
    );

    const removeAdjacentChip = useCallback(
      (direction: "backward" | "forward") => {
        const editor = editorRef.current;
        const point = editor ? selectionPoint(editor) : null;
        if (!editor || !point) return false;
        const current = valueRef.current;
        let index = direction === "backward" ? point.index - 1 : point.index;
        const target = current[point.index];
        if (target?.type === "text") {
          if (direction === "backward" && point.offset > 0) return false;
          if (direction === "forward" && point.offset < target.value.length) return false;
          index = direction === "backward" ? point.index - 1 : point.index + 1;
        }
        const node = current[index];
        if (!node || node.type === "text") return false;
        const next = current.filter((_, candidate) => candidate !== index);
        apply(next, { index: Math.max(0, Math.min(index, next.length)), offset: 0 });
        return true;
      },
      [apply]
    );

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (disabled || pendingSuggestionRef.current) {
        if (event.key !== "Tab") event.preventDefault();
        return;
      }
      if (composing.current || event.nativeEvent.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (restoreHistory(event.shiftKey ? 1 : -1)) event.preventDefault();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "y"
      ) {
        if (restoreHistory(1)) event.preventDefault();
        return;
      }
      if (effectiveQuery && projection.flat.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setSelected((current) =>
            (current + delta + projection.flat.length) %
            projection.flat.length
          );
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (activeSuggestion !== null) {
            chooseSuggestion(projection.flat[activeSuggestion]!);
          }
          return;
        }
      }
      if (event.key === "Escape" && query) {
        event.preventDefault();
        updateQuery(null);
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        removeAdjacentChip(event.key === "Backspace" ? "backward" : "forward")
      ) {
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const form = event.currentTarget.closest("form");
        const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (!submit?.disabled) form?.requestSubmit();
      }
    };

    const { onCompositionEnd, onCompositionStart, onCompositionUpdate } =
      useRichInputComposition({
        adoptNativeEditor,
        apply,
        committedComposition,
        composing,
        composition,
        editorRef,
        queryRef,
        setEditorEpoch,
        setPreview,
        setSelected,
        updateQuery,
        valueRef,
      });

    // data-slot 是编辑区外框的稳定锚点：消费方要改单行/多行几何，总得抓得住
    // 这一层，否则只能靠 :has() 反推结构。
    return (
      <div className="relative min-h-16 w-full" data-slot="rich-input">
        <SuggestionMenu
          active={activeSuggestion}
          copy={copy}
          disabled={disabled || suggestionPending}
          onActiveOptionIdChange={setActiveOptionId}
          onListIdChange={setSuggestionListId}
          onSelect={chooseSuggestion}
          projection={projection}
          query={effectiveQuery}
        />
        <div
          key={editorEpoch}
          ref={editorRef}
          aria-busy={suggestionPending}
          aria-disabled={disabled || suggestionPending}
          aria-label={messageLabel}
          aria-multiline="true"
          {...suggestionEditorAria(
            suggestionListId,
            effectiveQuery,
            activeOptionId
          )}
          className={cn(
            "max-h-48 min-h-16 w-full whitespace-pre-wrap overflow-y-auto px-3 pt-3 pb-2 text-sm outline-none",
            "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
            disabled && "cursor-not-allowed opacity-50",
            className
          )}
          contentEditable={!disabled && !suggestionPending}
          data-placeholder={resolvedPlaceholder}
          data-slot="input-group-control"
          onBlur={() => {
            if (editorRef.current) savedPoint.current = selectionPoint(editorRef.current);
          }}
          onCompositionEnd={onCompositionEnd}
          onCompositionStart={onCompositionStart}
          onCompositionUpdate={onCompositionUpdate}
          onInput={(event) => {
            if (
              composing.current ||
              (event.nativeEvent as InputEvent).isComposing
            ) {
              return;
            }
            adoptNativeEditor();
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => pasteRichPlainText(event, insertPlainText)}
          role="textbox"
          suppressContentEditableWarning
        >
          <RichInputNodes
            fileClickTitle={fileClickTitle}
            onFileClick={onFileClick}
            onWorkspaceFileClick={onWorkspaceFileClick}
            renderSectionIcon={renderSectionIcon}
            value={value}
            workspaceFileClickTitle={workspaceFileClickTitle}
          />
        </div>
        {suggestionPending ? (
          <span aria-live="polite" className="sr-only" role="status">
            {loadingLabel}
          </span>
        ) : null}
      </div>
    );
  }
);
