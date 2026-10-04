/**
 * [INPUT]: Depends on Base semantics, platform ports, six views, record slots, scoped drafts and host i18n.
 * [OUTPUT]: Provides BaseWorkbench with injected record actions/results/settings/toolbar, deletion-aware capabilities and persistent six-view editing.
 * [POS]: Shared Base composition; host contributions never replace the mounted workbench or its draft identity.
 */
import { type BaseWorkbenchProps } from "./workbench/props";


import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ListIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type {
  BaseAggregation,
  BaseCellContext,
  BaseColumn,
  BaseColumnType,
  BaseFilter,
  BaseMetaPatch,
  BaseRow,
  BaseRowPatch,
  BaseSelectOption,
  BaseSnapshot,
  BaseSort,
  BaseView,
  BaseViewConfig,
} from "@ai-chat/base-core/model/bases-ipc";
import {
  BASE_COLUMN_LIMIT,
  createBaseCellContext,
  isColumnScopedView,
  projectBaseRows,
} from "@ai-chat/base-core/model/bases-ipc";
import { renumberViews } from "@ai-chat/base-core/model/base-views";
import {
  useBaseSnapshots,
  useBasesNavigation,
} from "./platform/context";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import {
  BaseUiError,
  describeBaseFailure,
  type BaseMutationErrorCopy,
  isBaseRevisionConflict,
  type BaseMutationOutcome,
} from "./state/base-mutation-error";
import { createSurfaceLease } from "./state/lease-retry";
import { BaseToolbar } from "./chrome/base-toolbar";
import { viewConfigHitAreaClass } from "./views/view-config-bar";
import { BaseViewTabs } from "./chrome/base-view-tabs";
import { BaseTableView } from "./views/table/base-table-view";
import { BaseListView } from "./views/list/base-list-view";
import { BaseKanbanView } from "./views/kanban/base-kanban-view";
import {
  AddChartButton,
  BaseChartView,
  guessChartItem,
} from "./views/chart/base-chart-view";
import { applyChartOpToConfig, stripChartSorts, type ChartOp } from "../charts/chart-ops";
import { BaseGalleryView } from "./views/gallery/base-gallery-view";
import { useAppTranslation } from "./platform/i18n";
import { BaseRecordEditor, type BaseRecordDraft } from "./editors/cells/base-record-editor";
import { saveBaseRecord } from "./editors/cells/record-mutations";
import { BaseRecordBrowser } from "./editors/panels/base-record-browser";
import { BaseUIProvider, useBasePlatform } from "./platform/context";
import { useBaseSyncReview } from "./sync/state";
import { BaseSyncNotice } from "./sync/notice";
import { RecordSlotsProvider, RecordToolbar } from "./state/record-slots";
const EMPTY_OVERLAY: import("./media/model").GalleryItem[] = [];
import {
  baseEntityId,
  patchLatestGalleryConfig,
  prepareNewView,
  starterSelectOptions,
  visibleColumns,
  withGroupBy,
  withMapColumn,
  withTableAggregation,
  withTableColumnWidth,
  withVisibleColumns,
} from "./base-workbench-support";

const BaseMapView = lazy(() =>
  import("./views/base-map-view").then((module) => ({
    default: module.BaseMapView,
  }))
);

export function BaseWorkbench({
  ownerKey,
  compact = false,
  attachmentOwner,
  requestedViewId,
  requestedRecordId,
  onRecordChange,
  recordContributions,
  toolbar,
  onRunWorkflow,
  capability = "full",
  surfaceLeaseId,
  renewSurfaceLease,
}: BaseWorkbenchProps) {
  const { t } = useAppTranslation();
  const { ensure } = useBasesNavigation();
  const bases = useBaseSnapshots();
  const platform = useBasePlatform();
  const galleryOverlay = platform.overlay ?? EMPTY_OVERLAY;
  const snapshot = bases.snapshots[ownerKey];
  const instance = snapshot?.meta.ownerInstanceId;
  const sync = useBaseSyncReview(platform.sync, ownerKey, instance, snapshot?.meta.revision);
  const scopedPlatform = useMemo(() => ({ ...platform, attachments: { ...platform.attachments,
    preview: (input: Parameters<typeof platform.attachments.preview>[0], signal: AbortSignal) =>
      platform.attachments.preview({ ...input, ...(instance ? { baseOwner: { ownerKey, ownerInstanceId: instance } } : {}) }, signal),
  } }), [platform, ownerKey, instance]);
  const [loading, setLoading] = useState(!snapshot);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [openFailure, setOpenFailure] = useState<BaseMutationErrorCopy | null>(null);
  // Every write, the record dialog included, reads the lease here, so a renewal reaches all of them.
  const lease = useMemo(() => createSurfaceLease(surfaceLeaseId, renewSurfaceLease), [renewSurfaceLease]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => lease.adopt(surfaceLeaseId), [lease, surfaceLeaseId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recordOpen, setRecordOpen] = useState(false);
  const [record, setRecord] = useState<BaseRow | undefined>();
  const [newValues, setNewValues] = useState<BaseRow["values"]>({});
  const [recordsOpen, setRecordsOpen] = useState(false);
  const consumedRecordRef = useRef<number | string | null>(null);


  const [pendingViewId, setPendingViewId] = useState("");
  const desiredViewRef = useRef("");
  const persistingRef = useRef(false);
  const consumedRequestedViewRef = useRef<number | string | null>(null);

  const flipViewLocal = useCallback((viewId: string) => {
    desiredViewRef.current = viewId;
    setPendingViewId(viewId);
  }, []);
  const canStructure = capability === "full" && !sync.readOnly;
  const canConfigureViews = !sync.readOnly && (canStructure || capability === "data-write");

  const canMutateRows =
    !sync.readOnly && (capability === "full" || capability === "data-write" ||
    (capability === "row-write" && Boolean(surfaceLeaseId)));

  useEffect(() => {
    let active = true;
    void ensure(ownerKey)
      .catch(async (cause) => {
        const copy = await describeBaseFailure(cause, "open", async () => null);
        if (active) setOpenFailure(copy);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ensure, ownerKey, openAttempt]);

  const activeView =
    snapshot?.meta.views.find((view) => view.id === pendingViewId) ??
    snapshot?.meta.views.find((view) => view.id === snapshot.meta.activeViewId);
  useEffect(() => {
    if (
      !requestedViewId ||
      requestedViewId.nonce === consumedRequestedViewRef.current
    ) return;
    const requestedView = snapshot?.meta.views.find(
      (view) => view.id === requestedViewId.viewId
    );
    if (!requestedView) return;
    consumedRequestedViewRef.current = requestedViewId.nonce;

    queueMicrotask(() => flipViewLocal(requestedView.id));
  }, [flipViewLocal, requestedViewId, snapshot?.meta.views]);

  useEffect(() => {
    if (!requestedRecordId) { consumedRecordRef.current = null; return; }
    if (!snapshot || requestedRecordId.nonce === consumedRecordRef.current) return;
    consumedRecordRef.current = requestedRecordId.nonce;
    const row = snapshot.rows.find(item => item.id === requestedRecordId.recordId);
    queueMicrotask(() => {
      if (!row) { setError(t("bases.record.unavailable")); return; }
      setRecord(structuredClone(row)); setRecordOpen(true);
    });
  }, [requestedRecordId, snapshot, t]);

  const cellContext: BaseCellContext | null = useMemo(
    () => snapshot
      ? createBaseCellContext({
          columns: snapshot.meta.columns,
          rows: snapshot.rows,
        })
      : null,
    [snapshot]
  );
  const rows = useMemo(() => {
    if (!snapshot || !activeView || !cellContext) return [];
    return projectBaseRows(
      snapshot.rows,
      stripChartSorts(activeView.config),
      cellContext
    );
  }, [activeView, cellContext, snapshot]);

  const shell = (children: ReactNode) => (
    <BaseUIProvider value={scopedPlatform}><RecordSlotsProvider contributions={recordContributions}>
      <div className="flex h-full min-h-0 flex-col bg-background">{children}</div>
    </RecordSlotsProvider></BaseUIProvider>
  );

  if (loading || !snapshot || !activeView || !cellContext) {
    return shell(
      <div className="grid min-h-0 flex-1 place-items-center text-muted-foreground text-sm">
        {openFailure && !loading ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 text-center">
            <p className="text-destructive">{t(openFailure.copyKey, openFailure.values)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { setOpenFailure(null); setLoading(true); setOpenAttempt(value => value + 1); }}>
              {t("bases.gui.retry")}</Button>
          </div>
        ) : (
          <span className="flex items-center gap-2">
            <LoaderCircleIcon className="size-4 animate-spin" />
            {t("bases.loading")}
          </span>
        )}
      </div>
    );
  }

  const describeMutationError = async (cause: unknown) => {
    const copy = await describeBaseFailure(cause, "change", () => bases.get(ownerKey));
    return { copy, message: t(copy.copyKey, copy.values) };
  };
  /* The banner reports a failed change, except where the change's own surface already says it (the record dialog). */
  const run = async <T,>(operation: () => Promise<T>, banner = true) => {
    setBusy(true);
    setError("");
    try {
      return await lease.retry(operation);
    } catch (cause) {
      const { copy, message } = await describeMutationError(cause);
      if (banner) setError(message);
      throw Object.assign(new Error(message, { cause }), { code: (cause as { code?: unknown })?.code, baseCopy: copy });
    } finally {
      setBusy(false);
    }
  };

  const intent =
    <A extends unknown[]>(operation: (...args: A) => Promise<unknown>) =>
    (...args: A): Promise<BaseMutationOutcome> =>
      operation(...args).then(
        () => null,
        (cause: unknown) => errorMessage(cause)
      );

  const commitMeta = async (
    build: (latest: BaseSnapshot) => BaseMetaPatch,
    base: BaseSnapshot = snapshot
  ): Promise<BaseSnapshot> => {
    const submit = (latest: BaseSnapshot) =>
      bases.updateMeta({
        ownerKey,
        expectedRevision: latest.meta.revision,
        patch: build(latest),
        surfaceLeaseId: lease.current(),
      });
    try {
      return await submit(base);
    } catch (cause) {
      if (!isBaseRevisionConflict(cause)) throw cause;
      const latest = await bases.get(ownerKey);
      if (!latest) throw cause;
      return submit(latest);
    }
  };
  const updateLatestMeta = (build: (latest: BaseSnapshot) => BaseMetaPatch) =>
    run(() => commitMeta(build));

  const selectView = (viewId: string) => {
    flipViewLocal(viewId);
    if (!canConfigureViews) return;
    void persistActiveView().catch(async (cause) => {
      setPendingViewId("");
      setError((await describeMutationError(cause)).message);
    });
  };
  const persistActiveView = async () => {
    if (persistingRef.current) return;
    persistingRef.current = true;
    try {

      let latest = snapshot;
      for (;;) {
        const target = desiredViewRef.current;
        const exists = latest.meta.views.some((view) => view.id === target);
        if (!exists || latest.meta.activeViewId === target) break;
        latest = await commitMeta(() => ({ activeViewId: target }), latest);
        if (desiredViewRef.current === target) break;
      }
      setPendingViewId("");
    } finally {
      persistingRef.current = false;
    }
  };


  const updateActiveViewConfig = (
    build: (config: BaseViewConfig) => BaseViewConfig
  ) =>
    updateLatestMeta((latest) => {
      const latestView = latest.meta.views.find(
        (view) => view.id === activeView.id
      );
      if (!latestView) throw new BaseUiError("view_changed", "Active Base view is unavailable");
      return {
        views: latest.meta.views.map((view) =>
          view.id === latestView.id
            ? { ...view, config: build(view.config) }
            : view
        ),
      };
    });

  const resizeTableColumn = (columnId: string, width: number) =>
    updateActiveViewConfig((config) =>
      withTableColumnWidth(config, columnId, width)
    );
  const setTableAggregation = (
    columnId: string,
    aggregation?: BaseAggregation
  ) =>
    updateActiveViewConfig((config) =>
      withTableAggregation(config, columnId, aggregation)
    );
  const setGroupBy = (groupByColumnId: string) =>
    updateActiveViewConfig((config) => withGroupBy(config, groupByColumnId));
  const setVisibleColumns = (columnIds: string[]) =>
    updateActiveViewConfig((config) =>
      withVisibleColumns(config, columnIds, snapshot.meta.columns.length)
    );
  const setMapColumn = (
    key: "locationColumnId" | "labelColumnId",
    columnId: string
  ) =>
    updateActiveViewConfig((config) => withMapColumn(config, key, columnId));

  const applyChartOp = (op: ChartOp) =>
    updateActiveViewConfig((config) => {
      if (config.type !== "chart") throw new BaseUiError("view_changed", "Active Base view is not a Chart");
      return applyChartOpToConfig(config, op);
    });
  const chartOp = intent(applyChartOp);
  const renameView = (viewId: string, name: string) =>
    updateLatestMeta((latest) => ({
      views: latest.meta.views.map((view) =>
        view.id === viewId ? { ...view, name } : view
      ),
    }));
  const renameColumn = (columnId: string, name: string) =>
    updateLatestMeta((latest) => ({
      columns: latest.meta.columns.map((column) =>
        column.id === columnId ? { ...column, name } : column
      ),
    }));
  const setColumnWritableBy = (columnId: string, writableBy: "everyone" | "workflows") =>
    updateLatestMeta((latest) => ({
      columns: latest.meta.columns.map((column) => column.id === columnId && column.workflow ? { ...column, writableBy } : column),
    }));

  const updateSelectOption = (
    columnId: string,
    optionId: string,
    patch: Partial<Pick<BaseSelectOption, "label" | "color">>
  ) =>
    updateLatestMeta((latest) => ({
      columns: latest.meta.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              options: column.options?.map((option) =>
                option.id === optionId ? { ...option, ...patch } : option
              ),
            }
          : column
      ),
    }));
  const deleteColumn = (columnId: string) =>
    updateLatestMeta((latest) => ({
      columns: latest.meta.columns.filter(
        (column) => column.id !== columnId
      ),
    }));
  const deleteView = (viewId: string) =>
    updateLatestMeta((latest) => {
      const views = renumberViews(
        latest.meta.views.filter((view) => view.id !== viewId)
      );
      /* Reached only when another device deleted the other views while this Delete was being confirmed. */
      if (!views.length) throw new BaseUiError("view_limit", "A Base keeps at least one view");
      return {
        views,
        activeViewId: views.some((view) => view.id === latest.meta.activeViewId)
          ? latest.meta.activeViewId
          : views[0]!.id,
      };
    });
  const addColumn = async (
    type: BaseColumnType,
    formula?: NonNullable<BaseColumn["formula"]>
  ) => {
    if (type === "formula" && !formula) {
      throw new BaseUiError("invariant", "Formula metadata is required");
    }
    const id = baseEntityId("col");
    await updateLatestMeta((latest) => {
      const column: BaseColumn = {
        id,

        name: `${t(`bases.columnType.${type}`, { defaultValue: type })} ${latest.meta.columns.length + 1}`,
        type,
        ...(type === "select"
          ? {
              options: starterSelectOptions({
                todo: t("bases.starterStatus.todo"),
                doing: t("bases.starterStatus.doing"),
                done: t("bases.starterStatus.done"),
              }),
            }
          : {}),
        ...(type === "formula" ? { formula } : {}),
        ...(type === "relation"
          ? {
              relation: {
                labelColumnId:
                  latest.meta.columns.find((candidate) => candidate.type === "text")?.id ?? null,
              },
            }
          : {}),
      };

      return {
        columns: [...latest.meta.columns, column],
        views: latest.meta.views.map((view) =>
          isColumnScopedView(view.config) && view.config.visibleColumnIds?.length
            ? {
                ...view,
                config: {
                  ...view.config,
                  visibleColumnIds: [...view.config.visibleColumnIds, id],
                },
              }
            : view
        ),
      };
    });
  };
  const addView = async (type: BaseViewConfig["type"]) => {
    const id = baseEntityId("view");

    desiredViewRef.current = id;
    setPendingViewId(id);
    try {
      await updateLatestMeta((latest) => {
        const prepared = prepareNewView(type, latest.meta.columns, {
          image: t("bases.columnDefaults.image"),
          createdAt: t("bases.columnDefaults.createdAt"),
        });
        const view: BaseView = {
          id,

          name: `${t(`bases.viewType.${type}`, { defaultValue: type })} ${latest.meta.views.length + 1}`,
          order: latest.meta.views.length,
          config: prepared.config,
        };
        return {
          columns: prepared.columns,
          views: renumberViews([...latest.meta.views, view]),
          activeViewId: id,
        };
      });
    } finally {
      setPendingViewId("");
    }
  };
  const patch = (rowId: string, value: BaseRowPatch) =>
    run(() => bases.patchRow(ownerKey, rowId, value, lease.current()));
  const openRecord = (row?: BaseRow) => {
    setNewValues({});
    setRecord(row ? structuredClone(row) : undefined); setRecordsOpen(false); setRecordOpen(true);
    if (row) onRecordChange?.(row.id);
  };
  const addRow = async (values: BaseRow["values"] = {}) => { openRecord(); setNewValues(values); };
  const addToolbarRow = async () => { openRecord(); };
  const saveRecord = async (values: BaseRow["values"], _attachment?: File, draft?: BaseRecordDraft) => {
    if (!draft) throw new BaseUiError("invariant", "Record draft is required");
    await run(() => saveBaseRecord({ platform, snapshot, ownerKey, surfaceLeaseId: lease.current(), values, draft }), false);
  };
  const remove = (rowIds: string[]) =>
    run(() =>
      bases.deleteRows(
        ownerKey,
        rowIds,
        snapshot.meta.revision,
        lease.current()
      )
    );

  const renderActiveView = () => {
    const config = activeView.config;
    switch (config.type) {
      case "gallery":
        return (
          <BaseGalleryView
            busy={busy}
            context={cellContext}
            columns={snapshot.meta.columns}
            composerChatId={attachmentOwner?.chatId}
            composerIncarnationId={attachmentOwner?.incarnationId}
            config={config}
            ephemeralItems={galleryOverlay}
            onConfigPatch={

              canConfigureViews
                ? (configPatch) =>
                    updateLatestMeta((latest) =>
                      patchLatestGalleryConfig(
                        latest,
                        activeView.id,
                        configPatch
                      )
                    ).then(() => undefined)
                : undefined
            }
            ownerInstanceId={snapshot.meta.ownerInstanceId}
            ownerKey={ownerKey}
            rows={rows}
          />
        );
      case "table":
        return (
          <BaseTableView
            busy={busy}
            chatId={attachmentOwner?.chatId}
            columnAggregations={config.columnAggregations}
            columnWidths={config.columnWidths}
            columns={visibleColumns(snapshot.meta.columns, activeView)}
            context={cellContext}
            incarnationId={attachmentOwner?.incarnationId}
            compact={compact}
            groupByColumnId={config.groupByColumnId}
            onAddColumn={
              canStructure && snapshot.meta.columns.length < BASE_COLUMN_LIMIT
                ? intent(addColumn)
                : undefined
            }
            onDelete={canMutateRows ? intent(remove) : undefined}
            onDeleteColumn={canStructure ? intent(deleteColumn) : undefined}
            onColumnWidthChange={
              canConfigureViews ? intent(resizeTableColumn) : undefined
            }
            onAggregationChange={
              canConfigureViews ? intent(setTableAggregation) : undefined
            }
            onPatch={canMutateRows ? intent(patch) : undefined}
            onOpenRecord={openRecord}
            onRunWorkflow={onRunWorkflow}
            onColumnWritableByChange={canStructure ? intent(setColumnWritableBy) : undefined}
            onRenameColumn={canStructure ? intent(renameColumn) : undefined}
            ownerKey={ownerKey}
            relationOptions={snapshot.rows}
            onSortsChange={
              canConfigureViews
                ? intent((sorts: BaseSort[]) =>
                    updateActiveViewConfig((current) => ({
                      ...current,
                      sorts,
                    }))
                  )
                : undefined
            }
            rows={rows}
            sorts={config.sorts ?? []}
          />
        );
      case "list":
        return (
          <BaseListView
            busy={busy}
            chatId={attachmentOwner?.chatId}
            columns={visibleColumns(snapshot.meta.columns, activeView)}
            context={cellContext}
            groupByColumnId={config.groupByColumnId}
            incarnationId={attachmentOwner?.incarnationId}
            ownerKey={ownerKey}
            relationOptions={snapshot.rows}
            onCreateRow={canMutateRows ? intent(addRow) : undefined}
            onDelete={canMutateRows ? intent(remove) : undefined}
            onPatch={canMutateRows ? intent(patch) : undefined}
            rows={rows}
          />
        );
      case "kanban":
        return (
          <BaseKanbanView
            busy={busy}
            chatId={attachmentOwner?.chatId}
            columns={snapshot.meta.columns}
            context={cellContext}
            groupByColumnId={config.groupByColumnId}
            incarnationId={attachmentOwner?.incarnationId}
            onAddColumn={
              canStructure && snapshot.meta.columns.length < BASE_COLUMN_LIMIT
                ? intent(addColumn)
                : undefined
            }
            onAddRow={canMutateRows ? intent(addRow) : undefined}
            onOpenRow={openRecord}
            onPatch={canMutateRows ? intent(patch) : undefined}
            onUpdateOption={canStructure ? intent(updateSelectOption) : undefined}
            rows={rows}
            visibleColumnIds={config.visibleColumnIds}
          />
        );
      case "map":
        return (
          <Suspense
            fallback={
              <div className="grid min-h-0 flex-1 place-items-center text-muted-foreground text-sm">
                <span className="flex items-center gap-2">
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  {t("bases.loadingMap")}
                </span>
              </div>
            }
          >
            <BaseMapView
              busy={busy}
              columns={snapshot.meta.columns}
              context={cellContext}
              labelColumnId={config.labelColumnId}
              locationColumnId={config.locationColumnId}
              onAddColumn={
                canStructure && snapshot.meta.columns.length < BASE_COLUMN_LIMIT
                  ? intent(addColumn)
                  : undefined
              }
              onLabelColumnChange={
                canConfigureViews
                  ? intent((columnId: string) =>
                      setMapColumn("labelColumnId", columnId)
                    )
                  : undefined
              }
              onLocationColumnChange={
                canConfigureViews
                  ? intent((columnId: string) =>
                      setMapColumn("locationColumnId", columnId)
                    )
                  : undefined
              }
              rows={rows}
            />
          </Suspense>
        );
      case "chart":
        return (
          <BaseChartView
            busy={busy}
            charts={config.charts}
            columns={snapshot.meta.columns}
            context={cellContext}
            compact={compact}
            onOp={canConfigureViews ? (op) => void chartOp(op) : undefined}
            rows={rows}
            viewFilterScrubbed={config.viewFilterScrubbed}
          />
        );
      default:
        return null;
    }
  };

  return shell(
    <>
      {platform.sync && instance && <BaseSyncNotice key={`${platform.sync.scopeKey}:${ownerKey}:${instance}`}
        port={platform.sync} identity={{ ownerKey, baseId: instance }} value={sync.value} failed={sync.failed} />}
      <BaseToolbar
        allowRowMutation={
          canMutateRows
        }
        allowStructure={canStructure}
        allowViewConfiguration={canConfigureViews}
        activeViewId={activeView.id}
        busy={busy}
        filter={activeView.config.filter}
        meta={snapshot.meta}
        onAddColumn={intent(addColumn)}
        onAddRow={intent(addToolbarRow)}
        onDeleteColumn={intent(deleteColumn)}
        onRenameColumn={intent(renameColumn)}
        onColumnWritableByChange={canStructure ? intent(setColumnWritableBy) : undefined}
        onFilter={intent((filter: BaseFilter | undefined) =>
          updateActiveViewConfig((config) => {
            return config.type === "chart"
              ? { ...config, filter, viewFilterScrubbed: undefined }
              : { ...config, filter };
          })
        )}
        onGroupByChange={intent(setGroupBy)}
        onVisibleColumnsChange={intent(setVisibleColumns)}
        secondaryAction={<><RecordToolbar />{toolbar}<Button aria-label={t("bases.record.browse")} title={t("bases.record.browse")} className={viewConfigHitAreaClass}
          size="icon" variant="ghost" type="button" disabled={busy} onClick={() => setRecordsOpen(true)}><ListIcon /></Button></>}
        primaryAction={
          canConfigureViews && activeView.config.type === "chart" ? (
            <AddChartButton
              busy={busy}
              count={activeView.config.charts.length}
              onAdd={() =>
                void chartOp({
                  type: "append",
                  item: guessChartItem(snapshot.meta.columns),
                })
              }
            />
          ) : undefined
        }
        viewTabs={
          <BaseViewTabs
            activeViewId={activeView.id}
            busy={busy}
            editable={canConfigureViews}
            onAddView={intent(addView)}
            onDeleteView={intent(deleteView)}
            onRenameView={intent(renameView)}
            onSelect={selectView}
            views={snapshot.meta.views}
          />
        }
      />
      {error && (
        <p role="alert" className="border-b px-3 py-2 text-destructive text-xs">
          {error}
        </p>
      )}
      <BaseRecordEditor
        columns={snapshot.meta.columns}
        firstColumnId={
          activeView.config.type === "gallery"
            ? activeView.config.attachmentColumnId
            : undefined
        }
        ownerKey={ownerKey}
        ownerInstanceId={snapshot.meta.ownerInstanceId}
        lease={capability === "row-write" ? lease : undefined}
        record={record}
        initialValues={newValues}
        rows={snapshot.rows}
        disabled={!canMutateRows || busy}
        onOpenChange={open => { setRecordOpen(open); if (!open) onRecordChange?.(null); }}
        onSave={saveRecord}
        open={recordOpen}
      />
      <BaseRecordBrowser open={recordsOpen} rows={rows} columns={snapshot.meta.columns} context={cellContext}
        onOpenChange={setRecordsOpen} onSelect={openRecord} onCreate={canMutateRows ? () => openRecord() : undefined} />
      {renderActiveView()}
    </>
  );
}
