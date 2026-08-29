/**
 * [INPUT]: Depends on BasesProvider snapshots/mutations, i18n, the six row-backed views, owner-native uploads, chart operations, and Base chrome
 * [OUTPUT]: Provides BaseWorkbench with one snapshot-scoped canonical BaseCellContext, view-only row/column projection, CAS mutations, and full relation options
 * [POS]: The renderer Base composition root; it owns the canonical-versus-visible boundary and passes explicit context to every view/editor pipeline
 */

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
import { LoaderCircleIcon } from "lucide-react";
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
  BaseSort,
  BaseView,
  BaseViewConfig,
} from "../../../shared/bases-ipc";
import {
  createBaseCellContext,
  isColumnScopedView,
  projectBaseRows,
} from "../../../shared/bases-ipc";
import { renumberViews } from "../../../shared/base-views";
import { useBases } from "@/components/providers/bases-provider";
import { errorMessage } from "@/lib/errors";
import {
  baseMutationErrorCopy,
  isBaseRevisionConflict,
  recoverBaseMutationError,
  type BaseMutationOutcome,
} from "./state/base-mutation-error";
import { BaseQuarantineNotice } from "./base-quarantine-notice";
import { BaseToolbar } from "./chrome/base-toolbar";
import { BaseViewTabs } from "./chrome/base-view-tabs";
import { BaseTableView } from "./views/table/base-table-view";
import { BaseListView } from "./views/list/base-list-view";
import { BaseKanbanView } from "./views/kanban/base-kanban-view";
import {
  AddChartButton,
  BaseChartView,
  guessChartItem,
} from "./views/chart/base-chart-view";
import {
  applyChartOpToConfig,
  retryChartOp,
  stripChartSorts,
  type ChartOp,
} from "@/lib/charts/chart-ops";
import { BaseGalleryView } from "./views/gallery/base-gallery-view";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { BaseRecordEditor } from "./editors/cells/base-record-editor";
import { putBaseAttachment } from "@/lib/bases/client";
import { useGalleryRunningOverlay } from "@/lib/gallery/overlay";
import {
  patchLatestGalleryConfig,
  prepareGalleryUpload,
  prepareNewView,
  titleCase,
  visibleColumns,
  withGroupBy,
  withMapColumn,
  withTableAggregation,
  withTableColumnWidth,
  withVisibleColumns,
} from "./base-workbench-support";

// MapLibre 体量大且仅 map 视图需要：懒加载让其余视图与测试环境不背这份依赖
const BaseMapView = lazy(() =>
  import("./views/base-map-view").then((module) => ({
    default: module.BaseMapView,
  }))
);

type BaseWorkbenchCommonProps = {
  ownerKey: string;
  compact?: boolean;
  attachmentOwner?: { chatId: string; incarnationId: string };
  requestedViewId?: { viewId: string; nonce: number };
};

type BaseWorkbenchProps = BaseWorkbenchCommonProps &
  (
    | { capability?: "full"; surfaceLeaseId?: never }
    | { capability: "read"; surfaceLeaseId?: never }
    | { capability: "row-write"; surfaceLeaseId: string }
  );

export function BaseWorkbench({
  ownerKey,
  compact = false,
  attachmentOwner,
  requestedViewId,
  capability = "full",
  surfaceLeaseId,
}: BaseWorkbenchProps) {
  const { t } = useAppTranslation();
  const bases = useBases();
  const galleryOverlay = useGalleryRunningOverlay(attachmentOwner?.chatId);
  const ensure = bases.ensure;
  const snapshot = bases.snapshots[ownerKey];
  const [loading, setLoading] = useState(!snapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [corrupt, setCorrupt] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  // 乐观视图切换：pending 立即翻转 UI，持久化在后台单飞；
  // provider 在 updateMeta resolve 前已合并新 snapshot，故持久化收尾清 pending 不会闪回
  const [pendingViewId, setPendingViewId] = useState("");
  const desiredViewRef = useRef("");
  const persistingRef = useRef(false);
  const consumedRequestedViewRef = useRef(0);
  /* 「本地立即翻到某个视图」只有这一种写法：宿主请求与用户点击共用它，
     否则两处各抄一遍 ref+state，迟早只改对其中一处。 */
  const flipViewLocal = useCallback((viewId: string) => {
    desiredViewRef.current = viewId;
    setPendingViewId(viewId);
  }, []);
  const canStructure = capability === "full";
  /* 行写与结构写是两根独立的轴：row-write 有行无构，read 两者皆无。
     read 档不传任何 mutation 回调——affordance 随回调缺席而消失，
     视图内部不再需要知道「为什么不能写」。 */
  const canMutateRows =
    capability === "full" ||
    (capability === "row-write" && Boolean(surfaceLeaseId));

  useEffect(() => {
    let active = true;
    void ensure(ownerKey)
      .catch((cause) => {
        if (!active) return;
        const message = errorMessage(cause);
        setError(message);
        setCorrupt(message.includes("BASE_CORRUPT"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ensure, ownerKey]);

  // pending 视图被删时 ?? 自然回退到持久化视图，无需特判
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
    /* microtask 不是可有可无的包装：effect 体内同步 setState 会被
       react-hooks/set-state-in-effect 判为级联渲染（门禁级 error）。
       翻转本身共用 flipViewLocal，两处不再各写一份 ref+state。 */
    queueMicrotask(() => flipViewLocal(requestedView.id));
  }, [flipViewLocal, requestedViewId, snapshot?.meta.views]);
  /* snapshot 是唯一数据事实：视图只决定候选行/显示列，永远不能反过来重建
     relation/formula 的求值宇宙。上下文身份随 snapshot 变化，六类视图共用。 */
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

  // 头部 chrome 归宿主：第三栏 tab 条 / 全屏 PageShell，workbench 只有内容
  const shell = (children: ReactNode) => (
    <div className="flex h-full min-h-0 flex-col bg-background">{children}</div>
  );

  if (corrupt && !snapshot) {
    return shell(
      <BaseQuarantineNotice
        onDiscarded={() => setCorrupt(false)}
        ownerKey={ownerKey}
      />
    );
  }

  if (loading || !snapshot || !activeView || !cellContext) {
    return shell(
      <div className="grid min-h-0 flex-1 place-items-center text-muted-foreground text-sm">
        {error ? (
          <p className="px-6 text-center text-destructive">{error}</p>
        ) : (
          <span className="flex items-center gap-2">
            <LoaderCircleIcon className="size-4 animate-spin" />
            {t("bases.loading")}
          </span>
        )}
      </div>
    );
  }

  /* mutation 失败只有一条呈现路径。判别式 code 命中目录就说母语，
     其余交给冲突恢复（它顺带决定要不要全量回载）——两者都不该在
     调用点各写一遍，否则同一个 formula_cycle 在这条路上是中文、
     在那条路上还是 main 抛来的裸串。 */
  const describeMutationError = async (cause: unknown) => {
    const copy = baseMutationErrorCopy(cause);
    return copy
      ? t(copy.key, copy.values)
      : await recoverBaseMutationError(cause, () => bases.get(ownerKey));
  };
  const run = async <T,>(operation: () => Promise<T>) => {
    setBusy(true);
    setError("");
    try {
      return await operation();
    } catch (cause) {
      const message = await describeMutationError(cause);
      setError(message);
      // 收口文案随 rejection 下传：intent 与就地错误 UI 显示的与横幅同源
      throw new Error(message, { cause });
    } finally {
      setBusy(false);
    }
  };
  /* ── mutation intent 的唯一出口 ──────────────────────────────
   * run() 的 rejection 语义留给模块内部组合（saveGalleryRow 靠它中止）；
   * 跨出 workbench 的回调一律经 intent 折叠成 Promise<BaseMutationOutcome>，
   * 承诺永不 reject——「调用点忘记 .catch 就漏进程」这个失败模式在类型上不存在。
   * 例外只有两条不走 run() 的管道：record editor 的 onSave 与 gallery 的
   * onConfigPatch，它们各自持有就地错误 UI，主动消费 reject。 */
  const intent =
    <A extends unknown[]>(operation: (...args: A) => Promise<unknown>) =>
    (...args: A): Promise<BaseMutationOutcome> =>
      operation(...args).then(
        () => null,
        (cause: unknown) => errorMessage(cause)
      );
  const updateMeta = (patch: BaseMetaPatch) =>
    run(() =>
      bases.updateMeta({
        ownerKey,
        expectedRevision: snapshot.meta.revision,
        patch,
        surfaceLeaseId,
      })
    );
  // 提交前读取最新 snapshot：视图级 CAS 都走这一条路径
  const updateLatestMeta = (
    build: (latest: NonNullable<Awaited<ReturnType<typeof bases.get>>>) =>
      BaseMetaPatch
  ) =>
    run(async () => {
      const latest = await bases.get(ownerKey);
      if (!latest) throw new Error("Base 尚未创建");
      return bases.updateMeta({
        ownerKey,
        expectedRevision: latest.meta.revision,
        patch: build(latest),
        surfaceLeaseId,
      });
    });
  // 切换视图：本地即时翻转 + 单飞持久化，末次点击胜出；不走 run()，永不置 busy
  const selectView = (viewId: string) => {
    flipViewLocal(viewId);
    if (!canStructure) return;
    void persistActiveView().catch(async (cause) => {
      setPendingViewId("");
      setError(await describeMutationError(cause));
    });
  };
  const persistActiveView = async () => {
    if (persistingRef.current) return;
    persistingRef.current = true;
    try {
      for (;;) {
        const target = desiredViewRef.current;
        const latest = await bases.get(ownerKey);
        const exists = latest?.meta.views.some((view) => view.id === target);
        if (!latest || !exists || latest.meta.activeViewId === target) break;
        await bases.updateMeta({
          ownerKey,
          expectedRevision: latest.meta.revision,
          patch: { activeViewId: target },
          surfaceLeaseId,
        });
        if (desiredViewRef.current === target) break;
      }
      setPendingViewId("");
    } finally {
      persistingRef.current = false;
    }
  };
  // 视图 config 的唯一 CAS 通道：filter/sorts/列宽/kanban 分组/map 列选择全走 builder；
  // 目标锁定渲染期有效视图（含 pending），避免乐观切换窗口内打到旧视图
  const updateActiveViewConfig = (
    build: (config: BaseViewConfig) => BaseViewConfig
  ) =>
    updateLatestMeta((latest) => {
      const latestView = latest.meta.views.find(
        (view) => view.id === activeView.id
      );
      if (!latestView) throw new Error("Active Base view 不存在");
      return {
        views: latest.meta.views.map((view) =>
          view.id === latestView.id
            ? { ...view, config: build(view.config) }
            : view
        ),
      };
    });
  /* 五条视图 config 变换都是纯函数（含各自的「当前视图支不支持」守卫），
     住在 base-workbench-support；这里只负责把它们接到同一条 CAS 上。
     分组的空串即取消（kanban 无此相，由 toolbar 不给 None 兜住）。 */
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
    run(() =>
      retryChartOp(
        async () => {
          const latest = await bases.get(ownerKey);
          if (!latest) throw new Error("Base 尚未创建");
          return latest;
        },
        (latest) => {
          const view = latest.meta.views.find(
            (candidate) => candidate.id === activeView.id
          );
          if (!view || view.config.type !== "chart") {
            throw new Error("Active Base view 不是 Chart");
          }
          const config = applyChartOpToConfig(view.config, op);
          return bases.updateMeta({
            ownerKey,
            expectedRevision: latest.meta.revision,
            patch: {
              views: latest.meta.views.map((candidate) =>
                candidate.id === view.id ? { ...candidate, config } : candidate
              ),
            },
            surfaceLeaseId,
          });
        },
        isBaseRevisionConflict
      )
    );
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
  /* select option 的就地编辑（看板 lane 头的改名/改色都走这里）。
   * 落笔在 column 上而非视图上：option 是列的一部分，改名一次全库同步——
   * 若各视图各存一份别名，同一个值就会在两块板上叫两个名字。 */
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
      if (!views.length) throw new Error(t("bases.workbench.viewLimit"));
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
      throw new Error("Formula metadata is required");
    }
    const id = `col_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const column: BaseColumn = {
      id,
      name: `${titleCase(type)} ${snapshot.meta.columns.length + 1}`,
      type,
      ...(type === "select"
        ? {
            options: [
              { id: "todo", label: "Todo" },
              { id: "doing", label: "Doing" },
              { id: "done", label: "Done" },
            ],
          }
        : {}),
      ...(type === "formula" ? { formula } : {}),
      ...(type === "relation"
        ? {
            relation: {
              labelColumnId:
                snapshot.meta.columns.find((candidate) => candidate.type === "text")?.id ?? null,
            },
          }
        : {}),
    };
    /* 新列必须进已物化的可见清单：清单是「显这些」而非「藏那些」，
     * 不追加，新列就会在藏过字段的视图里默认隐身——用户没藏它，也没人告诉他。 */
    await updateMeta({
      columns: [...snapshot.meta.columns, column],
      views: snapshot.meta.views.map((view) =>
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
    });
  };
  const addView = async (type: BaseViewConfig["type"]) => {
    const id = `view_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const prepared = prepareNewView(type, snapshot.meta.columns);
    const view: BaseView = {
      id,
      /* 新视图的默认名按当前语言取一次：它是落盘的数据，此后不再随语言变。 */
      name: `${t(`bases.viewType.${type}`, { defaultValue: type })} ${snapshot.meta.views.length + 1}`,
      order: snapshot.meta.views.length,
      config: prepared.config,
    };
    // 新增即选中：同步 pending，防残留的乐观切换视觉覆盖新视图；落盘后交还真相源
    desiredViewRef.current = id;
    setPendingViewId(id);
    try {
      await updateMeta({
        columns: prepared.columns,
        views: renumberViews([...snapshot.meta.views, view]),
        activeViewId: id,
      });
    } finally {
      setPendingViewId("");
    }
  };
  const patch = (rowId: string, value: BaseRowPatch) =>
    run(() => bases.patchRow(ownerKey, rowId, value, surfaceLeaseId));
  const insert = (row: BaseRow) =>
    run(() => bases.insertRows(ownerKey, [row], surfaceLeaseId));
  // 加行只有一种写法：toolbar 加空行、看板 lane 头预置分组值，同一函数两种入参
  const addRow = (values: BaseRow["values"] = {}) =>
    insert({ id: crypto.randomUUID().replaceAll("-", ""), values });
  const addToolbarRow = async () => {
    if (activeView.config.type === "gallery") {
      setRecordOpen(true);
      return;
    }
    await addRow();
  };
  const saveGalleryRow = async (
    values: BaseRow["values"],
    attachment?: File
  ) => {
    const rowId = crypto.randomUUID().replaceAll("-", "");
    if (activeView.config.type !== "gallery") return;
    const upload = await prepareGalleryUpload({
      ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      expectedRevision: snapshot.meta.revision,
      rowId,
      columnId: activeView.config.attachmentColumnId,
      file: attachment,
      attachmentRequiredMessage: t("bases.record.attachmentRequired"),
      unsupportedImageMessage: t("bases.record.unsupportedImage"),
      fileReadFailedMessage: t("bases.record.fileReadFailed"),
    });
    const result = await putBaseAttachment({ ...upload, surfaceLeaseId });
    if (!result.ok) throw new Error(result.error.message);
    const rowPatch = Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, Exclude<(typeof entry)[1], undefined>] =>
          entry[1] !== undefined
      )
    );
    if (Object.keys(rowPatch).length) await patch(rowId, rowPatch);
  };
  const remove = (rowIds: string[]) =>
    run(() =>
      bases.deleteRows(
        ownerKey,
        rowIds,
        snapshot.meta.revision,
        surfaceLeaseId
      )
    );

  return shell(
    <>
      {/* 操作带不按视图类型分身：曾以 key={activeView.config.type} 强制重挂载，
          于是每换一种视图类型，filter/columns 面板的开合就被连根拔起——同一条工具栏
          换个视图并不会变成另一条工具栏。筛选草稿靠 FilterEditor 自己那枚 key 换血。 */}
      <BaseToolbar
        allowRowMutation={
          canMutateRows
        }
        allowStructure={canStructure}
        activeViewId={activeView.id}
        busy={busy}
        filter={activeView.config.filter}
        meta={snapshot.meta}
        onAddColumn={intent(addColumn)}
        onAddRow={intent(addToolbarRow)}
        onDeleteColumn={intent(deleteColumn)}
        onRenameColumn={intent(renameColumn)}
        onFilter={intent((filter: BaseFilter | undefined) =>
          updateActiveViewConfig((config) => {
            return config.type === "chart"
              ? { ...config, filter, viewFilterScrubbed: undefined }
              : { ...config, filter };
          })
        )}
        onGroupByChange={intent(setGroupBy)}
        onVisibleColumnsChange={intent(setVisibleColumns)}
        primaryAction={
          canStructure && activeView.config.type === "chart" ? (
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
            editable={canStructure}
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
        onOpenChange={setRecordOpen}
        onSave={saveGalleryRow}
        open={recordOpen && activeView.config.type === "gallery"}
      />
      {activeView.config.type === "gallery" ? (
        <BaseGalleryView
          busy={busy}
          context={cellContext}
          columns={snapshot.meta.columns}
          composerChatId={attachmentOwner?.chatId}
          composerIncarnationId={attachmentOwner?.incarnationId}
          config={activeView.config}
          ephemeralItems={galleryOverlay}
          onConfigPatch={
            /* 不走 intent 的 reject 消费者：gallery 持有就地错误 UI（announceError），
               错因随 rejection 下传，与顶部横幅同源。 */
            canStructure
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
          revision={snapshot.meta.revision}
          rows={rows}
        />
      ) : activeView.config.type === "table" ? (
        <BaseTableView
          busy={busy}
          chatId={attachmentOwner?.chatId}
          columnAggregations={activeView.config.columnAggregations}
          columnWidths={activeView.config.columnWidths}
          columns={visibleColumns(snapshot.meta.columns, activeView)}
          context={cellContext}
          incarnationId={attachmentOwner?.incarnationId}
          compact={compact}
          groupByColumnId={activeView.config.groupByColumnId}
          onAddColumn={
            canStructure && snapshot.meta.columns.length < 64
              ? intent(addColumn)
              : undefined
          }
          onDelete={canMutateRows ? intent(remove) : undefined}
          onDeleteColumn={canStructure ? intent(deleteColumn) : undefined}
          onColumnWidthChange={
            canStructure ? intent(resizeTableColumn) : undefined
          }
          onAggregationChange={
            canStructure ? intent(setTableAggregation) : undefined
          }
          onPatch={canMutateRows ? intent(patch) : undefined}
          onRenameColumn={canStructure ? intent(renameColumn) : undefined}
          ownerKey={ownerKey}
          relationOptions={snapshot.rows}
          onSortsChange={
            canStructure
              ? intent((sorts: BaseSort[]) =>
                  updateActiveViewConfig((config) => ({
                    ...config,
                    sorts,
                  }))
                )
              : undefined
          }
          rows={rows}
          sorts={activeView.config.sorts ?? []}
        />
      ) : activeView.config.type === "list" ? (
        <BaseListView
          busy={busy}
          chatId={attachmentOwner?.chatId}
          columns={visibleColumns(snapshot.meta.columns, activeView)}
          context={cellContext}
          groupByColumnId={activeView.config.groupByColumnId}
          incarnationId={attachmentOwner?.incarnationId}
          ownerKey={ownerKey}
          relationOptions={snapshot.rows}
          onCreateRow={canMutateRows ? intent(addRow) : undefined}
          onDelete={canMutateRows ? intent(remove) : undefined}
          onPatch={canMutateRows ? intent(patch) : undefined}
          rows={rows}
        />
      ) : activeView.config.type === "kanban" ? (
        <BaseKanbanView
          busy={busy}
          chatId={attachmentOwner?.chatId}
          columns={snapshot.meta.columns}
          context={cellContext}
          groupByColumnId={activeView.config.groupByColumnId}
          incarnationId={attachmentOwner?.incarnationId}
          onAddColumn={
            canStructure && snapshot.meta.columns.length < 64
              ? intent(addColumn)
              : undefined
          }
          onAddRow={canMutateRows ? intent(addRow) : undefined}
          onPatch={canMutateRows ? intent(patch) : undefined}
          onUpdateOption={canStructure ? intent(updateSelectOption) : undefined}
          rows={rows}
          visibleColumnIds={activeView.config.visibleColumnIds}
        />
      ) : activeView.config.type === "map" ? (
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
            labelColumnId={activeView.config.labelColumnId}
            locationColumnId={activeView.config.locationColumnId}
            onAddColumn={
              canStructure && snapshot.meta.columns.length < 64
                ? intent(addColumn)
                : undefined
            }
            onLabelColumnChange={
              canStructure
                ? intent((columnId: string) =>
                    setMapColumn("labelColumnId", columnId)
                  )
                : undefined
            }
            onLocationColumnChange={
              canStructure
                ? intent((columnId: string) =>
                    setMapColumn("locationColumnId", columnId)
                  )
                : undefined
            }
            rows={rows}
          />
        </Suspense>
      ) : activeView.config.type === "chart" ? (
        <BaseChartView
          busy={busy}
          charts={activeView.config.charts}
          columns={snapshot.meta.columns}
          context={cellContext}
          compact={compact}
          onOp={canStructure ? (op) => void chartOp(op) : undefined}
          rows={rows}
          viewFilterScrubbed={activeView.config.viewFilterScrubbed}
        />
      ) : null}
    </>
  );
}
