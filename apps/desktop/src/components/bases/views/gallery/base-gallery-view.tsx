/**
 * [INPUT]: Depends on row-backed Gallery model, Base owner/rows/columns/config, Chat ephemeral overlay, ledger receipt, Gallery store/focus, virtual listbox and setting bar native language
 * [OUTPUT]: Provides BaseGalleryView; Durable rows Projection, receipt-first Flashless identity migration/source clearance, column/date setting, browsing/selecting/temporary comments and scaling
 * [POS]: Base Sixth is a thin interactive root of native row-backed view; Only in the Chat host merged overlay, Project/App, and naturally only read durable rows
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  CheckIcon,
  MessageCircleIcon,
  MousePointer2Icon,
} from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  BaseColumn,
  BaseRow,
  BaseViewConfig,
} from "../../../../../shared/bases-ipc";
import {
  groupGalleryItems,
  projectGalleryRows,
  type GalleryItem,
} from "@/lib/gallery/model";
import {
  deleteGalleryComment,
  expireGallerySource,
  reconcileGallerySources,
  saveGalleryComment,
  selectGalleryItem,
  useGalleryState,
  migrateGalleryIdentity,
} from "@/lib/gallery/store";
import { listBaseGalleryEntries } from "@/lib/bases/client";
import {
  focusComposer,
  registerGalleryFocus,
} from "@/lib/gallery/focus-controller";
import {
  ViewConfigBar,
  ViewConfigSelect,
  viewConfigHitAreaClass,
} from "../view-config-bar";
import {
  GalleryCommentEditor,
  type GalleryCommentEditorValue,
} from "./gallery-comment-editor";
import {
  GalleryListbox,
  type GalleryMode,
} from "./gallery-listbox";
import { GALLERY_ZOOM_OPTIONS } from "./gallery-zoom";

type GalleryConfig = Extract<BaseViewConfig, { type: "gallery" }>;
type ReadyGalleryItem = Extract<GalleryItem, { phase: "ready" }>;

const GALLERY_MODES: Array<{
  mode: GalleryMode;
  Icon: typeof CheckIcon;
}> = [
  { mode: "browse", Icon: MousePointer2Icon },
  { mode: "multi", Icon: CheckIcon },
  { mode: "comment", Icon: MessageCircleIcon },
];
const EMPTY_RECEIPT_ALIASES = new Map<string, GalleryItem>();
type ReceiptAliasSnapshot = {
  requestKey: string;
  aliases: ReadonlyMap<string, GalleryItem>;
  sourceKeys: ReadonlySet<string>;
};

export function BaseGalleryView({
  ownerKey,
  ownerInstanceId,
  revision,
  rows,
  columns,
  config,
  composerChatId,
  composerIncarnationId,
  ephemeralItems = [],
  busy = false,
  onConfigPatch,
}: {
  ownerKey: string;
  ownerInstanceId: string;
  revision: number;
  rows: BaseRow[];
  columns: BaseColumn[];
  config: GalleryConfig;
  composerChatId?: string;
  composerIncarnationId?: string;
  ephemeralItems?: GalleryItem[];
  busy?: boolean;
  onConfigPatch?(patch: Partial<Omit<GalleryConfig, "type">>): Promise<void>;
}) {
  const { t } = useAppTranslation();
  const durableItems = useMemo(
    () =>
      projectGalleryRows({
        ownerKey,
        ownerInstanceId,
        rows,
        columns,
        config,
      }),
    [columns, config, ownerInstanceId, ownerKey, rows]
  );
  const stateKey = composerChatId ?? ownerKey;
  const state = useGalleryState(stateKey);
  const [mode, setMode] = useState<GalleryMode>("browse");
  const [zoom, setZoom] = useState(100);
  const [activeId, setActiveId] = useState("");
  const [editor, setEditor] = useState<GalleryCommentEditorValue | null>(null);
  const [focusPins, setFocusPins] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const ephemeralItemsRef = useRef(ephemeralItems);
  const receiptRequestKey =
    composerChatId && composerIncarnationId
      ? JSON.stringify([
          composerChatId,
          composerIncarnationId,
          ownerKey,
          ownerInstanceId,
          revision,
          config.attachmentColumnId,
        ])
      : "";
  const [receiptSnapshot, setReceiptSnapshot] =
    useState<ReceiptAliasSnapshot>({
      requestKey: "",
      aliases: EMPTY_RECEIPT_ALIASES,
      sourceKeys: new Set(),
    });
  const receiptsReady =
    Boolean(receiptRequestKey) &&
    receiptSnapshot.requestKey === receiptRequestKey;
  const activeReceiptAliases =
    receiptsReady
      ? receiptSnapshot.aliases
      : EMPTY_RECEIPT_ALIASES;
  const activeMode = composerChatId ? mode : "browse";
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const contentRefs = useRef(new Map<string, HTMLImageElement>());
  const items = useMemo(
    () => [
      ...durableItems,
      ...ephemeralItems.filter(
        (item) => !activeReceiptAliases.has(item.logicalKey)
      ),
    ],
    [activeReceiptAliases, durableItems, ephemeralItems]
  );
  const groups = useMemo(
    () =>
      groupGalleryItems(items, {
        bucket: config.dateBucket,
        grouped: Boolean(config.groupByDateColumnId),
        ungroupedLabel: t("bases.gallery.ungrouped", {
          defaultValue: "Ungrouped",
        }),
      }),
    [config.dateBucket, config.groupByDateColumnId, items, t]
  );
  const durableByCell = useMemo(
    () =>
      new Map<string, ReadyGalleryItem>(
        durableItems.flatMap(
          (item): Array<readonly [string, ReadyGalleryItem]> =>
            item.phase === "ready" && item.sourceRef.kind === "attachment"
              ? [
                  [
                    `${item.sourceRef.rowId}:${item.sourceRef.columnId}`,
                    item,
                  ] as const,
                ]
              : []
        )
      ),
    [durableItems]
  );
  const currentSourceKeys = useMemo(
    () =>
      new Set([
        ...items.map((item) => item.logicalKey),
        ...(receiptsReady ? receiptSnapshot.sourceKeys : []),
      ]),
    [items, receiptSnapshot.sourceKeys, receiptsReady]
  );
  const currentActiveId =
    activeId && items.some((item) => item.id === activeId)
      ? activeId
      : items.at(-1)?.id ?? "";

  useEffect(() => {
    ephemeralItemsRef.current = ephemeralItems;
  }, [ephemeralItems]);
  useEffect(() => {
    if (!composerChatId || !composerIncarnationId || !receiptRequestKey) return;
    let active = true;
    void listBaseGalleryEntries({
      chatId: composerChatId,
      incarnationId: composerIncarnationId,
      columnId: config.attachmentColumnId,
    }).then((result) => {
      if (!active || !result.ok) return;
      const aliases = new Map<string, GalleryItem>();
      const sourceKeys = new Set<string>();
      for (const association of result.value.entries) {
        const receiptKeys = receiptLogicalKeys(
          association.logicalKey,
          composerChatId,
          composerIncarnationId
        );
        for (const logicalKey of receiptKeys) sourceKeys.add(logicalKey);
        const ready = durableByCell.get(association.galleryItemId);
        if (!ready) continue;
        for (const logicalKey of receiptKeys) {
          aliases.set(logicalKey, ready);
          migrateGalleryIdentity(composerChatId, logicalKey, ready);
        }
      }
      setReceiptSnapshot({
        requestKey: receiptRequestKey,
        aliases,
        sourceKeys,
      });
      setActiveId((current) => {
        const overlay = ephemeralItemsRef.current.find(
          (item) => item.id === current
        );
        return overlay
          ? aliases.get(overlay.logicalKey)?.id ?? current
          : current;
      });
    });
    return () => {
      active = false;
    };
  }, [
    composerChatId,
    composerIncarnationId,
    config.attachmentColumnId,
    durableByCell,
    receiptRequestKey,
  ]);
  useEffect(() => {
    if (!composerChatId || !receiptsReady) return;
    reconcileGallerySources(composerChatId, currentSourceKeys);
  }, [composerChatId, currentSourceKeys, receiptsReady]);
  useEffect(() => {
    if (!composerChatId) return;
    return registerGalleryFocus(composerChatId, () => {
      const next =
        optionRefs.current.get(currentActiveId) ??
        optionRefs.current.values().next().value;
      next?.focus();
    });
  }, [composerChatId, currentActiveId]);
  useLayoutEffect(() => {
    if (!focusPins.size) return;
    if (currentActiveId) {
      optionRefs.current.get(currentActiveId)?.focus({ preventScroll: true });
    }
    const frame = requestAnimationFrame(() => setFocusPins(new Set()));
    return () => cancelAnimationFrame(frame);
  }, [currentActiveId, focusPins]);
  const announceError = (cause: unknown) => {
    setAnnouncement(
      cause instanceof Error ? cause.message : t("bases.gallery.actionFailed")
    );
  };
  const activate = (item: GalleryItem) => {
    setActiveId(item.id);
    if (!composerChatId || item.phase !== "ready") return;
    void selectGalleryItem(
      composerChatId,
      item,
      activeMode === "multi"
    ).catch(announceError);
  };
  const placeComment = (
    event: MouseEvent<HTMLDivElement>,
    item: Extract<GalleryItem, { phase: "ready" }>
  ) => {
    if (!composerChatId) return;
    const image = contentRefs.current.get(item.id);
    if (!image) return;
    const rect = image.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }
    setEditor({
      item,
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      text: "",
    });
  };
  const restoreFocus = (itemId: string, commentId?: string) => {
    setEditor(null);
    requestAnimationFrame(() => {
      const option = optionRefs.current.get(itemId);
      const badge = commentId
        ? option?.parentElement?.querySelector<HTMLButtonElement>(
            `[data-badge-id="${commentId}"]`
          )
        : null;
      (badge ?? option)?.focus();
    });
  };
  const selectedKeys = useMemo(
    () => new Set(state.selections.keys()),
    [state.selections]
  );
  const patchConfig = (
    patch: Partial<Omit<GalleryConfig, "type">>
  ) => {
    if (!onConfigPatch) return;
    void onConfigPatch(patch).catch(announceError);
  };

  return (
    <section
      aria-label={t("bases.gallery.aria")}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      <div className="@container/gallery-bar shrink-0">
        <ViewConfigBar>
          <ViewConfigSelect
            disabled={busy || !onConfigPatch}
            label={t("bases.gallery.attachmentColumn", {
              defaultValue: "Image",
            })}
            onChange={(attachmentColumnId) =>
              patchConfig({ attachmentColumnId })
            }
            options={columns.filter((column) => column.type === "attachment")}
            value={config.attachmentColumnId}
          />
          <ViewConfigSelect
            disabled={busy || !onConfigPatch}
            label={t("bases.gallery.titleColumn", { defaultValue: "Title" })}
            onChange={(titleColumnId) =>
              patchConfig({ titleColumnId: titleColumnId || undefined })
            }
            options={columns}
            placeholder={t("common.none", { defaultValue: "None" })}
            value={config.titleColumnId ?? ""}
          />
          <ViewConfigSelect
            disabled={busy || !onConfigPatch}
            label={t("bases.gallery.dateColumn", { defaultValue: "Group date" })}
            onChange={(groupByDateColumnId) =>
              patchConfig({
                groupByDateColumnId: groupByDateColumnId || undefined,
                dateBucket: groupByDateColumnId
                  ? config.dateBucket ?? "day"
                  : undefined,
              })
            }
            options={columns.filter((column) => column.type === "date")}
            placeholder={t("common.none", { defaultValue: "None" })}
            value={config.groupByDateColumnId ?? ""}
          />
          {config.groupByDateColumnId && (
            <ViewConfigSelect
              disabled={busy || !onConfigPatch}
              label={t("bases.gallery.dateBucket", { defaultValue: "Bucket" })}
              onChange={(dateBucket) =>
                patchConfig({
                  dateBucket: dateBucket as GalleryConfig["dateBucket"],
                })
              }
              options={["minute", "hour", "day", "week", "month"].map((id) => ({
                id,
                name: t(`bases.gallery.bucket.${id}`, { defaultValue: id }),
              }))}
              value={config.dateBucket ?? "day"}
            />
          )}
          {composerChatId && (
            <GalleryModeSwitch mode={activeMode} onMode={setMode} />
          )}
          <div className="ml-auto">
            <ViewConfigSelect
              label={t("bases.gallery.zoom")}
              onChange={(id) => setZoom(Number(id) || 100)}
              options={GALLERY_ZOOM_OPTIONS}
              value={String(zoom)}
            />
          </div>
        </ViewConfigBar>
      </div>
      {!items.length ? (
        <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
          <div>
            <MessageCircleIcon className="mx-auto mb-3 size-7 text-muted-foreground" />
            <p className="font-medium text-sm">
              {t("bases.gallery.emptyTitle")}
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              {t("bases.gallery.emptyHint")}
            </p>
          </div>
        </div>
      ) : (
        <GalleryListbox
          activeId={currentActiveId}
          comments={state.comments}
          contentRefs={contentRefs}
          focusPins={focusPins}
          groups={groups}
          items={items}
          mode={activeMode}
          onActivate={activate}
          onActive={setActiveId}
          onCenterComment={(item) => {
            if (composerChatId) {
              setEditor({ item, x: 0.5, y: 0.5, text: "" });
            }
          }}
          onDeleteComment={(item, id) => {
            if (!composerChatId) return;
            try {
              deleteGalleryComment(composerChatId, item.logicalKey, id);
            } catch (cause) {
              announceError(cause);
            }
          }}
          onEditComment={(item, comment) => {
            if (composerChatId) setEditor({ ...comment, item });
          }}
          onExitMode={() => setMode("browse")}
          onFocusPins={setFocusPins}
          onPlaceComment={placeComment}
          onReturnToComposer={
            composerChatId
              ? () => focusComposer(composerChatId)
              : undefined
          }
          onSourceGone={(item) => {
            if (composerChatId) {
              expireGallerySource(composerChatId, item.logicalKey);
            }
            setAnnouncement(t("bases.gallery.sourceGone"));
          }}
          optionRefs={optionRefs}
          overlayId={editor?.item.id}
          selectedKeys={selectedKeys}
          zoom={zoom}
        />
      )}
      {editor && composerChatId && (
        <GalleryCommentEditor
          editor={editor}
          onCancel={() => restoreFocus(editor.item.id, editor.id)}
          onPosition={(x, y) => setEditor({ ...editor, x, y })}
          onSave={() => {
            if (!editor.text.trim()) return;
            try {
              saveGalleryComment(composerChatId, editor.item, editor);
              restoreFocus(editor.item.id, editor.id);
            } catch (cause) {
              announceError(cause);
            }
          }}
          onText={(text) => setEditor({ ...editor, text })}
        />
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

function receiptLogicalKeys(
  logicalKey: string,
  chatId: string,
  incarnationId: string
) {
  const scopedPrefix = `transcript:${chatId}:${incarnationId}:`;
  return logicalKey.startsWith(scopedPrefix)
    ? [logicalKey, `transcript:${logicalKey.slice(scopedPrefix.length)}`]
    : [logicalKey];
}

function GalleryModeSwitch({
  mode,
  onMode,
}: {
  mode: GalleryMode;
  onMode(next: GalleryMode): void;
}) {
  const { t } = useAppTranslation();
  return (
    <div
      aria-label={t("bases.gallery.modeAria")}
      className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
      role="group"
    >
      {GALLERY_MODES.map(({ mode: value, Icon }) => {
        const label = t(`bases.gallery.mode.${value}`);
        return (
          <button
            key={value}
            aria-label={label}
            aria-pressed={mode === value}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm px-2 font-medium text-xs transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3.5 [&_svg]:shrink-0",
              viewConfigHitAreaClass,
              mode === value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onMode(value)}
            title={label}
            type="button"
          >
            <Icon />
            <span className="hidden @[26rem]/gallery-bar:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
