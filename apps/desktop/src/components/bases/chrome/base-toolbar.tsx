/**
 * [INPUT]: Depends on React, shared Base meta/filter contracts, i18n, mutation outcomes, and UI menus/forms/icons
 * [OUTPUT]: Provides BaseToolbar, filter/column editors, localized column actions, and formula-aware column chips
 * [POS]: Shared Base chrome action band; BaseWorkbench owns CAS mutations while this module owns their visible controls
 */

import { useMemo, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { BaseMutationOutcome } from "../state/base-mutation-error";
import {
  CalendarIcon,
  CheckIcon,
  Columns3Icon,
  EyeIcon,
  EyeOffIcon,
  FunnelIcon,
  GitForkIcon,
  HashIcon,
  ImageIcon,
  LinkIcon,
  ListTreeIcon,
  MapPinIcon,
  PlusIcon,
  SquareCheckIcon,
  SigmaIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  BaseCellValue,
  BaseColumn,
  BaseColumnType,
  BaseFilter,
  BaseFilterComparison,
  BaseMeta,
} from "../../../../shared/bases-ipc";
import {
  dedupeSelectOptions,
  formulaExpressionForDisplay,
  isBaseAttachmentValue,
  isColumnScopedView,
  isGroupableView,
} from "../../../../shared/bases-ipc";
import { BaseFormulaEditor } from "../editors/panels/base-formula-editor";
import { InlineNameInput } from "./inline-name-input";

// ============================================================================
// 列类型的唯一目录：菜单渲染即数据遍历，不再散落 option 分支
// ============================================================================

const COLUMN_TYPES: Array<{
  type: BaseColumnType;
  Icon: typeof TypeIcon;
}> = [
  { type: "text", Icon: TypeIcon },
  { type: "number", Icon: HashIcon },
  { type: "date", Icon: CalendarIcon },
  { type: "select", Icon: CheckIcon },
  { type: "checkbox", Icon: SquareCheckIcon },
  { type: "url", Icon: LinkIcon },
  { type: "location", Icon: MapPinIcon },
  { type: "attachment", Icon: ImageIcon },
  { type: "formula", Icon: SigmaIcon },
  { type: "relation", Icon: GitForkIcon },
];

/**
 * 列芯片内动作的显现通道：hover 与 focus-visible 双通道，与表头/行动作同构——
 * 只有鼠标能到达的功能等于键盘用户不存在。显隐与删除共用它，两枚按钮的
 * 「什么时候出现」是同一个决定，不该各写一遍再慢慢分叉。
 */
const chipActionRevealClass =
  "cursor-pointer text-muted-foreground opacity-0 transition-opacity group-hover/column-chip:opacity-100 group-has-[:focus-visible]/column-chip:opacity-100";

export const baseActionButtonClass =
  "cursor-pointer rounded-sm p-1 text-muted-foreground! transition-colors hover:bg-transparent hover:text-foreground! focus:text-foreground!";

/**
 * 与表头 hover 同构：表头只给背景换 muted，不加深任何前景。
 * DropdownMenuItem 默认的 accent 前景会连子元素一起强制变色（`**:text-accent-foreground`），
 * 把「默认浅色、hover 才强调」的操作按钮一并拉深，故用同前缀的 text-inherit 覆盖——
 * 前缀一致 tailwind-merge 才认得出是同一组，不必赌 CSS 顺序。
 */
export const baseMenuItemHoverClass =
  "focus:bg-muted focus:text-foreground not-data-[variant=destructive]:focus:**:text-inherit";

export const baseDestructiveActionButtonClass = cn(
  baseActionButtonClass,
  "hover:text-destructive! focus:text-destructive!"
);

export function BaseToolbar({
  meta,
  activeViewId,
  filter,
  busy,
  viewTabs,
  onFilter,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onGroupByChange,
  onVisibleColumnsChange,
  onAddRow,
  primaryAction,
  allowStructure = true,
  allowRowMutation = true,
}: {
  meta: BaseMeta;
  activeViewId: string;
  filter?: BaseFilter;
  busy: boolean;
  viewTabs: React.ReactNode;
  /* intent 一律来自 workbench 的收口出口：判决即返回值，永不 reject。 */
  onFilter(filter?: BaseFilter): Promise<BaseMutationOutcome>;
  onAddColumn(
    type: BaseColumnType,
    formula?: NonNullable<BaseColumn["formula"]>
  ): Promise<BaseMutationOutcome>;
  onRenameColumn(id: string, name: string): Promise<BaseMutationOutcome>;
  onDeleteColumn(id: string): Promise<BaseMutationOutcome>;
  onGroupByChange(columnId: string): Promise<BaseMutationOutcome>;
  /** 字段可见性 intent；只有 column-scoped 视图（table/list/kanban）会拿到 */
  onVisibleColumnsChange(columnIds: string[]): Promise<BaseMutationOutcome>;
  onAddRow(): Promise<BaseMutationOutcome>;
  /** 视图特定主按钮（如 chart 视图的 Add chart）；缺省渲染 Add row */
  primaryAction?: React.ReactNode;
  allowStructure?: boolean;
  allowRowMutation?: boolean;
}) {
  const { t } = useAppTranslation();
  const [columnsOpen, setColumnsOpen] = useState(false);
  /* 面板开合只归用户，与 columnsOpen 同一条规矩。曾是 `useState(Boolean(filter))`：
   * 「有筛选」于是「面板展开」——数据替用户做了决定。而推断出来的初值只在重挂载时
   * 才被重新计算，于是它永远只朝「展开」一个方向复活：用户亲手收起的面板，切一趟
   * 视图（或换个会话回来）就又长回来了，收起这个动作等于没发生过。
   * 有没有筛选自有漏斗上的圆点去说，与 Manage columns 同一种语言；开合是意图，
   * 意图只能由点击产生，不能由数据推断。 */
  const [filterOpen, setFilterOpen] = useState(false);
  const [renameColumnId, setRenameColumnId] = useState("");
  const [deleteColumnId, setDeleteColumnId] = useState("");
  const activeView = meta.views.find((view) => view.id === activeViewId);
  const deleteColumn = meta.columns.find(
    (column) => column.id === deleteColumnId
  );
  // Kanban 没有「不分组」这一相：lane 就是分组本身，故它独占默认列与无 None 两条特例
  const kanban = activeView?.config.type === "kanban";
  const groupable = Boolean(activeView && isGroupableView(activeView.config));
  const groupColumns = meta.columns.filter(
    (column) => column.type === "select"
  );
  const configuredGroupId =
    activeView && isGroupableView(activeView.config)
      ? activeView.config.groupByColumnId
      : undefined;
  const groupColumn =
    groupColumns.find((column) => column.id === configuredGroupId) ??
    (kanban ? groupColumns[0] : undefined);
  /* 字段可见性以「隐藏集」在本地推理，落盘却写「显哪些」——
   * 两种表述各有主场：隐藏集让 toggle 只是一次 add/delete，与列的多少无关；
   * visibleColumnIds 让读取侧不必知道 Base 现在共有几列。转换只此一处。 */
  const scopedConfig =
    activeView && isColumnScopedView(activeView.config)
      ? activeView.config
      : undefined;
  const visibleColumnIds = scopedConfig?.visibleColumnIds;
  /* 「显哪些」是数组，「藏哪些」才是这里要问的问题。曾用 includes 逐列回查
     整张显示清单——列数一多就是 O(n²)，且每次重渲染重来一遍。先把显示清单
     收成 Set，判定便与列数无关；memo 让它只在配置真的变了时重建。 */
  const hiddenColumnIds = useMemo(() => {
    if (!visibleColumnIds?.length) return new Set<string>();
    const visible = new Set(visibleColumnIds);
    return new Set(
      meta.columns
        .map((column) => column.id)
        .filter((id) => !visible.has(id))
    );
  }, [meta.columns, visibleColumnIds]);
  const toggleColumnVisible = (columnId: string) => {
    const hidden = new Set(hiddenColumnIds);
    if (!hidden.delete(columnId)) hidden.add(columnId);
    return onVisibleColumnsChange(
      meta.columns
        .filter((column) => !hidden.has(column.id))
        .map((column) => column.id)
    );
  };
  return (
    <div className="shrink-0 border-b bg-background">
      {/* ── 行高与内容解耦 ──────────────────────────────────────────
       * 曾是 py-1.5 + flex-wrap：行高 = 动作簇最高者。于是 Table（28px
       * 按钮）40px、Gallery（12px 说明文字）36px——切一次视图，tab 条
       * 自己往上跳 4px。病根不是某个分支算错了高度，是「高度由内容决定」
       * 这件事本身：每加一种视图就多一次赌博。改由容器一口咬定 40px，
       * 分支再多也无从抖动；tab 溢出交给内部横向滚动，故不再 wrap。
       * ────────────────────────────────────────────────────────── */}
      <div className="flex h-10 items-center gap-1 px-2">
        {viewTabs}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {allowStructure && <Button
            aria-label={t("bases.toolbar.toggleFilter")}
            className="relative"
            onClick={() => setFilterOpen((value) => !value)}
            size="icon"
            title={t("bases.toolbar.filterRows")}
            type="button"
            variant={filterOpen ? "secondary" : "ghost"}
          >
            <FunnelIcon />
            {filter && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
          </Button>}
          {allowStructure && <Button
            aria-label={t("bases.toolbar.manageColumns")}
            className="relative"
            onClick={() => setColumnsOpen((value) => !value)}
            size="icon"
            title={t("bases.toolbar.manageColumns")}
            type="button"
            variant={columnsOpen ? "secondary" : "ghost"}
          >
            <Columns3Icon />
            {/* 与 Filter 同一枚圆点语言：有字段被藏起来时，「我的列去哪了」
                必须在面板打开之前就能被看见，否则用户只会以为数据丢了 */}
            {hiddenColumnIds.size > 0 && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
          </Button>}
          {allowStructure && groupable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t("bases.toolbar.groupByCurrent", {
                    column: groupColumn?.name ?? t("bases.toolbar.groupNone"),
                  })}
                  disabled={busy || (kanban && groupColumns.length === 0)}
                  size="icon"
                  title={t("bases.toolbar.groupBy")}
                  type="button"
                  variant={groupColumn ? "secondary" : "ghost"}
                >
                  <ListTreeIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuLabel>{t("bases.toolbar.groupBy")}</DropdownMenuLabel>
                {!kanban && (
                  <DropdownMenuItem
                    className={baseMenuItemHoverClass}
                    onSelect={() => void onGroupByChange("")}
                  >
                    <CheckIcon
                      className={cn("size-3.5", groupColumn && "opacity-0")}
                    />
                    {t("bases.toolbar.groupNone")}
                  </DropdownMenuItem>
                )}
                {groupColumns.map((column) => (
                  <DropdownMenuItem
                    key={column.id}
                    className={baseMenuItemHoverClass}
                    onSelect={() => void onGroupByChange(column.id)}
                  >
                    <CheckIcon
                      className={cn(
                        "size-3.5",
                        column.id !== groupColumn?.id && "opacity-0"
                      )}
                    />
                    {column.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {allowStructure && primaryAction ? primaryAction :
            (allowRowMutation && (
            <Button
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => void onAddRow()}
              size="sm"
              type="button"
              variant="default"
            >
              <PlusIcon />
              {t("bases.toolbar.addRow")}
            </Button>
          ))}
        </div>
      </div>
      {allowStructure && filterOpen && (
        <div className="border-t px-2 py-1.5">
          <BaseFilterEditor
            key={`${activeViewId}:${meta.columns.map((column) => column.id).join(",")}:${JSON.stringify(filter)}`}
            busy={busy}
            columns={meta.columns}
            filter={filter}
            onFilter={onFilter}
          />
        </div>
      )}
      {allowStructure && columnsOpen && (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-2 py-1.5">
          {meta.columns.map((column) => {
            const Icon =
              COLUMN_TYPES.find((item) => item.type === column.type)?.Icon ??
              TypeIcon;
            if (column.id === renameColumnId) {
              return (
                <InlineNameInput
                  key={column.id}
                  ariaLabel={t("bases.table.renameColumnAria", {
                    column: column.name,
                  })}
                  autoFocus
                  className="h-7 w-28 text-xs"
                  name={column.name}
                  onDone={() => setRenameColumnId("")}
                  onRename={(name) => onRenameColumn(column.id, name)}
                />
              );
            }
            const hidden = hiddenColumnIds.has(column.id);
            /* 公式表达式此前只活在「添加公式列」那一刻的对话框里：列建好之后，
               「这一列到底是怎么算出来的」在产品里再也找不回来。列管理面板是
               唯一能同时看见所有列的地方，故还原成列名的表达式挂在芯片上——
               落盘的是 columnId，给人看的必须是列名，改名后仍读得懂。 */
            const expression =
              column.type === "formula" && column.formula
                ? formulaExpressionForDisplay(
                    column.formula.expression,
                    meta.columns
                  )
                : "";
            return (
              <span
                key={column.id}
                className={cn(
                  "group/column-chip inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-xs",
                  hidden && "border-dashed bg-transparent text-muted-foreground"
                )}
                data-column-hidden={hidden || undefined}
              >
                {/* 前导图标只说列的类型，不兼职开关：一枚图标既是信息又是控件，
                    两个身份互相掩护，谁也认不出它可以点。 */}
                <Icon className="size-3 text-muted-foreground" />
                <button
                  aria-label={t("bases.table.renameColumnAria", {
                    column: column.name,
                  })}
                  className={cn(
                    "cursor-pointer hover:underline",
                    hidden && "line-through decoration-muted-foreground/50"
                  )}
                  disabled={busy}
                  onClick={() => setRenameColumnId(column.id)}
                  title={t("bases.toolbar.renameColumn")}
                  type="button"
                >
                  {column.name}
                </button>
                {expression && (
                  <code
                    className="max-w-40 truncate font-mono text-[10px] text-muted-foreground"
                    data-formula-expression={column.id}
                    title={expression}
                  >
                    {expression}
                  </code>
                )}
                {/* 显隐与删除同级，同一条显现通道：动作住在动作该在的位置。
                    唯一的例外是「已藏」——此时 EyeOff 不只是动作，还是这枚芯片
                    当下状态的说明，跟着 hover 一起消失就等于把状态也藏了，
                    与列表行「编辑中的按钮不再隐去」同一条规矩。 */}
                {scopedConfig && (
                  <button
                    aria-label={t(
                      hidden
                        ? "bases.toolbar.showColumn"
                        : "bases.toolbar.hideColumn",
                      { column: column.name }
                    )}
                    aria-pressed={!hidden}
                    className={cn(
                      chipActionRevealClass,
                      "hover:text-foreground",
                      hidden && "opacity-100"
                    )}
                    disabled={busy}
                    onClick={() => void toggleColumnVisible(column.id)}
                    title={t(
                      hidden
                        ? "bases.toolbar.showField"
                        : "bases.toolbar.hideField"
                    )}
                    type="button"
                  >
                    {hidden ? (
                      <EyeOffIcon className="size-3" />
                    ) : (
                      <EyeIcon className="size-3" />
                    )}
                  </button>
                )}
                <button
                  aria-label={t("bases.toolbar.deleteColumn", { column: column.name })}
                  className={cn(chipActionRevealClass, "hover:text-destructive")}
                  disabled={busy}
                  onClick={() => setDeleteColumnId(column.id)}
                  type="button"
                >
                  <Trash2Icon className="size-3" />
                </button>
              </span>
            );
          })}
          <AddColumnMenu
            columns={meta.columns}
            onAddColumn={onAddColumn}
            trigger={
              <Button
                className="h-7 border-0 text-xs"
                disabled={busy || meta.columns.length >= 64}
                size="sm"
                type="button"
                variant="ghost"
              >
                <PlusIcon />
                {t("bases.toolbar.addColumn")}
              </Button>
            }
          />
        </div>
      )}
      {allowStructure && <ConfirmationDialog
        busy={busy}
        confirmLabel={t("bases.table.deleteColumnConfirm")}
        confirmTone="destructive"
        description={t("bases.table.deleteColumnDescription", {
          column: deleteColumn?.name ?? "",
        })}
        onConfirm={() =>
          void onDeleteColumn(deleteColumnId).then((error) => {
            // 失败留在原地：错因在顶部横幅，弹窗关掉反而抹掉现场
            if (!error) setDeleteColumnId("");
          })
        }
        onOpenChange={(open) => {
          if (!open) setDeleteColumnId("");
        }}
        open={Boolean(deleteColumn)}
        title={t("bases.table.deleteColumnTitle")}
      />}
    </div>
  );
}

// 复用的加列菜单：toolbar 列管理行与表格表头 "+" 共用同一份类型目录
export function AddColumnMenu({
  columns,
  onAddColumn,
  trigger,
}: {
  columns: BaseColumn[];
  onAddColumn(
    type: BaseColumnType,
    formula?: NonNullable<BaseColumn["formula"]>
  ): Promise<BaseMutationOutcome>;
  trigger: React.ReactNode;
}) {
  const { t } = useAppTranslation();
  const [formulaOpen, setFormulaOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("bases.toolbar.columnTypeLabel")}</DropdownMenuLabel>
          {COLUMN_TYPES.map(({ type, Icon }) => (
            <DropdownMenuItem
              key={type}
              className={baseMenuItemHoverClass}
              onSelect={() =>
                type === "formula"
                  ? setFormulaOpen(true)
                  : void onAddColumn(type)
              }
            >
              <Icon className="size-3.5" />
              {t(`bases.columnType.${type}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {formulaOpen && (
        <BaseFormulaEditor
          columns={columns}
          onOpenChange={setFormulaOpen}
          onSubmit={(formula) => onAddColumn("formula", formula)}
          open
        />
      )}
    </>
  );
}

type FilterOperator = BaseFilterComparison["operator"];

/* 数学算子是符号，不是语言：=/≠/>/≥/</≤ 五种语言写法相同，硬留在表里；
   三个词语算子才进目录，key 即算子 id。 */
const FILTER_OPERATORS: Array<{
  value: FilterOperator;
  symbol?: string;
}> = [
  { value: "contains" },
  { value: "eq", symbol: "=" },
  { value: "neq", symbol: "≠" },
  { value: "gt", symbol: ">" },
  { value: "gte", symbol: "≥" },
  { value: "lt", symbol: "<" },
  { value: "lte", symbol: "≤" },
  { value: "is-empty" },
  { value: "not-empty" },
];

export function BaseFilterEditor({
  columns,
  filter,
  busy,
  onFilter,
}: {
  columns: BaseMeta["columns"];
  filter?: BaseFilter;
  busy: boolean;
  onFilter(filter?: BaseFilter): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const condition = filter?.kind === "condition" ? filter : undefined;
  const [columnId, setColumnId] = useState(
    condition?.columnId ?? columns[0]?.id ?? ""
  );
  const [operator, setOperator] = useState<FilterOperator>(
    condition?.operator ?? "contains"
  );
  const [rawValue, setRawValue] = useState(
    condition && "value" in condition
      ? filterValueText(condition.value)
      : ""
  );
  const [validation, setValidation] = useState("");
  const needsValue = operator !== "is-empty" && operator !== "not-empty";
  const selectedColumn = columns.find((column) => column.id === columnId);
  const operators =
    selectedColumn?.type === "attachment"
      ? FILTER_OPERATORS.filter(
          ({ value }) => value === "is-empty" || value === "not-empty"
        )
      : FILTER_OPERATORS;
  if (!columns.length) {
    return (
      <span className="text-muted-foreground text-xs">
        {t("bases.filter.noColumns")}
      </span>
    );
  }
  const apply = () => {
    try {
      const column = columns.find((candidate) => candidate.id === columnId);
      if (!column) throw new Error("column");
      const next = buildBaseFilterCondition(
        column.type === "formula"
          ? column.formula?.resultType === "number"
            ? "number"
            : column.formula?.resultType === "boolean"
              ? "checkbox"
              : "text"
          : column.type,
        columnId,
        operator,
        rawValue
      );
      setValidation("");
      void onFilter(next);
    } catch (cause) {
      /* 校验器抛的是「错在哪一类」的码，不是句子：纯函数不认识语言，
         把它翻成人话是这一层的职责。 */
      setValidation(
        cause instanceof Error
          ? t(`bases.filter.error.${cause.message}`, {
              defaultValue: cause.message,
            })
          : String(cause)
      );
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Select
        disabled={busy}
        onValueChange={(next) => {
          setColumnId(next);
          const nextColumn = columns.find((column) => column.id === next);
          if (nextColumn?.type === "attachment") setOperator("is-empty");
          setRawValue("");
          setValidation("");
        }}
        value={columnId}
      >
        <SelectTrigger
          aria-label={t("bases.filter.column")}
          className="h-7 min-w-24 bg-background px-2 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {columns.map((column) => (
            <SelectItem key={column.id} value={column.id}>
              {column.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        disabled={busy}
        onValueChange={(next) => setOperator(next as FilterOperator)}
        value={operator}
      >
        <SelectTrigger
          aria-label={t("bases.filter.operator")}
          className="h-7 bg-background px-2 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.symbol ?? t(`bases.filter.operatorLabel.${item.value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue && selectedColumn?.type === "select" ? (
        <Select
          disabled={busy}
          onValueChange={setRawValue}
          value={rawValue}
        >
          <SelectTrigger
            aria-label={t("bases.filter.value")}
            className="h-7 min-w-24 bg-background px-2 text-xs"
          >
            <SelectValue placeholder={t("bases.filter.valuePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {dedupeSelectOptions(selectedColumn.options).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : needsValue ? (
        <Input
          aria-label={t("bases.filter.value")}
          className="h-7 min-w-24 flex-1 text-xs"
          disabled={busy}
          onChange={(event) => setRawValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply();
          }}
          placeholder={t("bases.filter.valuePlaceholder")}
          value={rawValue}
        />
      ) : null}
      <Button
        className="h-7 text-xs"
        disabled={busy}
        onClick={apply}
        size="sm"
        type="button"
        variant="outline"
      >
        {t("bases.filter.apply")}
      </Button>
      {filter && (
        <Button
          className="h-7 text-xs"
          disabled={busy}
          onClick={() => void onFilter(undefined)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("bases.filter.clear")}
        </Button>
      )}
      {filter && filter.kind !== "condition" && (
        <span className="text-muted-foreground text-[10px]">
          {t("bases.filter.compoundHint")}
        </span>
      )}
      {validation && (
        <span role="alert" className="text-destructive text-[10px]">
          {validation}
        </span>
      )}
    </div>
  );
}

/* 过滤 AST 的唯一产地就是上面那只编辑器：导出它，别处就会绕过校验
   自己拼 condition，而「空值算不算错」这类判断便有了第二份答案。 */
function buildBaseFilterCondition(
  columnType: BaseColumnType,
  columnId: string,
  operator: FilterOperator,
  rawValue: string
): BaseFilterComparison {
  if (
    columnType === "attachment" &&
    operator !== "is-empty" &&
    operator !== "not-empty"
  ) {
    throw new Error("attachment");
  }
  if (operator === "is-empty" || operator === "not-empty") {
    return { kind: "condition", columnId, operator };
  }
  const value = parseBaseFilterValue(columnType, rawValue);
  return { kind: "condition", columnId, operator, value };
}

function parseBaseFilterValue(
  columnType: BaseColumnType,
  rawValue: string
): BaseCellValue {
  const value = rawValue.trim();
  if (!value) throw new Error("empty");
  if (columnType === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("number");
    return number;
  }
  if (columnType === "checkbox") {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error("boolean");
  }
  if (columnType === "location") {
    const [latText, lngText, extra] = value.split(",");
    const lat = Number(latText);
    const lng = Number(lngText);
    if (
      extra !== undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new Error("location");
    }
    return { lat, lng };
  }
  return value;
}

function filterValueText(value: BaseCellValue | undefined) {
  if (value && typeof value === "object") {
    return isBaseAttachmentValue(value)
      ? value.filename
      : `${value.lat},${value.lng}`;
  }
  return String(value ?? "");
}
