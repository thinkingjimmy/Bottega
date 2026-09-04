/**
 * [INPUT]: Depends on Base/Apps/Chats/Projects providers, router navigation, dialogs, menus, i18n, and structured client error codes
 * [OUTPUT]: Provides BaseHeaderActions and useBaseAppActions; XLSX issue disclosure and the promotion attempt fence stay module-private
 * [POS]: Header action boundary for components/bases/chrome; transport codes are translated here and Base data mutations stay in providers
 */

import { useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Link, useNavigate } from "react-router";
import {
  DatabaseBackupIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  ImportIcon,
  Maximize2Icon,
  MoreHorizontalIcon,
  Minimize2Icon,
  PackagePlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
  useBaseSnapshots,
  useBasesNavigation,
} from "@/components/providers/bases-provider";
import { useOptionalApps } from "@/components/providers/apps-provider";
import { useOptionalChats } from "@/components/providers/chats-provider";
import { useOptionalProjects } from "@/components/providers/projects-provider";
import { SaveAsAppDialog } from "@/components/apps/dialogs/save-as-app-dialog";
import { panelChromeClassName } from "@/components/page-shell";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  ownerFromKey,
  type BaseColumn,
  type BaseXlsxIssue,
} from "../../../../shared/bases-ipc";
import { errorMessage } from "@/lib/errors";

export function useBaseAppActions(ownerKey: string, chatId?: string) {
  const { t } = useAppTranslation();
  const bases = useBaseSnapshots();
  const records = useOptionalApps()?.records ?? [];
  const chats = useOptionalChats()?.chats ?? [];
  const projects = useOptionalProjects()?.projects ?? [];
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionIssues, setActionIssues] = useState<BaseXlsxIssue[]>([]);
  const snapshot = bases.snapshots[ownerKey];
  const owner = ownerFromKey(ownerKey);
  const sourceChat =
    owner.kind === "chat"
      ? chats.find((chat) => chat.id === owner.chatId)
      : chatId
        ? chats.find((chat) => chat.id === chatId)
        : undefined;
  const projectId =
    owner.kind === "project" ? owner.projectId : sourceChat?.projectId;
  const project = projects.find((candidate) => candidate.id === projectId);
  const appId =
    project?.workspaceBinding.kind === "app"
      ? project.workspaceBinding.appId
      : "";
  const app = records.find(
    (record) => record.id === appId && record.manifest?.kind === "base"
  );
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setActionError("");
    setActionNotice("");
    setActionIssues([]);
    try {
      await operation();
    } catch (cause) {
      console.warn(`[bases] header action failed ownerKey=${ownerKey}`, cause);
      const copyKey = headerErrorCopyKey(cause);
      /* 失败后不再补一发全量 get：provider 的 snapshot 已经是本机真相，
         而导入/导出失败本身从不改变它——那一次 IPC 只是把同一份数据再取一遍。 */
      setActionError(
        copyKey
          ? t(copyKey)
          : errorMessage(cause, t("bases.header.ioFailed"))
      );
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = () => run(() => bases.exportCsv(ownerKey));
  const exportJson = () => run(() => bases.exportJson(ownerKey));
  const exportXlsx = () => run(() => bases.exportXlsx(ownerKey));
  const importJson = () =>
    snapshot
      ? run(() => bases.importJson(ownerKey, snapshot.meta.revision))
      : Promise.resolve();
  const importXlsx = () =>
    snapshot
      ? run(async () => {
          const result = await bases.importXlsx(ownerKey, snapshot.meta.revision);
          if (result.cancelled) return;
          /* 语义披露与坏单元格计数是两件独立的事实，故是两句话：
             「按 id 匹配的行整行替换、未含列清空」在没有任何 issue 时同样成立——
             只在出错时才说，等于把最容易吞掉数据的那条规则藏进了错误路径。 */
          setActionIssues([...result.issues]);
          setActionNotice(t("bases.header.importXlsxSemantics"));
        })
      : Promise.resolve();
  return {
    app,
    actionError,
    actionIssues,
    actionNotice,
    busy,
    columns: snapshot?.meta.columns ?? [],
    defaultName: sourceChat?.title || snapshot?.meta.name || "My App",
    ready: Boolean(snapshot),
    saveChatId: owner.kind === "chat" ? owner.chatId : "",
    exportCsv,
    exportJson,
    exportXlsx,
    importJson,
    importXlsx,
  };
}

/* 一次导入最多带回 500 条逐格失败。全量铺开的代价不是滚动条长，是这块
   告示牌自己变成一份无人读的日志——前 50 条已足够认出「哪一列、哪一类」，
   余下的用一句话交代清楚有多少，而不是静默少给。 */
const XLSX_ISSUE_RENDER_LIMIT = 50;

function XlsxImportIssueDetails({
  columns,
  issues,
}: {
  columns: readonly BaseColumn[];
  issues: readonly BaseXlsxIssue[];
}) {
  const { t } = useAppTranslation();
  if (!issues.length) return null;
  const shown = issues.slice(0, XLSX_ISSUE_RENDER_LIMIT);
  const remaining = issues.length - shown.length;
  return (
    <details className="mt-1 border-t pt-1 text-xs">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium">
        {t("bases.header.importXlsxDetails")}
      </summary>
      <ol className="max-h-48 list-decimal space-y-1 overflow-y-auto pr-2 pl-5">
        {shown.map((issue, index) => {
          const column = columns.find((candidate) => candidate.id === issue.columnId);
          const columnLabel = column
            ? `${column.name} (${issue.columnId})`
            : issue.columnId;
          const reason = localizeXlsxIssue(t, issue.reason);
          return (
            <li data-row-index={issue.rowIndex} key={`${issue.rowIndex}:${issue.columnId}:${index}`}>
              {t("bases.header.importXlsxIssue", {
                column: columnLabel,
                reason,
                row: issue.rowIndex + 2,
              })}
            </li>
          );
        })}
      </ol>
      {remaining > 0 && (
        <p className="pt-1 pl-5 text-muted-foreground">
          {t("bases.header.importXlsxMoreIssues", { count: remaining })}
        </p>
      )}
    </details>
  );
}

function localizeXlsxIssue(
  t: ReturnType<typeof useAppTranslation>["t"],
  reason: BaseXlsxIssue["reason"]
) {
  return t(XLSX_ISSUE_KEYS[reason]);
}

const XLSX_ISSUE_KEYS = {
  cell_too_large: "bases.header.importXlsxCellTooLarge",
  formula_read_only: "bases.header.importXlsxFormulaReadOnly",
  attachment_not_importable: "bases.header.importXlsxAttachmentNotImportable",
  relation_target_missing: "bases.header.importXlsxRelationTargetMissing",
  invalid_relation: "bases.header.importXlsxInvalidValue",
  invalid_text: "bases.header.importXlsxInvalidValue",
  invalid_number: "bases.header.importXlsxInvalidValue",
  invalid_date: "bases.header.importXlsxInvalidValue",
  invalid_select_option: "bases.header.importXlsxInvalidValue",
  invalid_checkbox: "bases.header.importXlsxInvalidValue",
  invalid_https_url: "bases.header.importXlsxInvalidValue",
  invalid_location: "bases.header.importXlsxInvalidValue",
} as const satisfies Record<BaseXlsxIssue["reason"], string>;

const HEADER_ERROR_KEYS = {
  xlsx_issue_limit: "bases.header.importXlsxIssueLimit",
  json_import_unavailable: "bases.header.importJsonUnavailable",
  xlsx_import_unavailable: "bases.header.importXlsxUnavailable",
} as const;

function headerErrorCopyKey(cause: unknown) {
  if (!cause || typeof cause !== "object" || !("code" in cause)) return null;
  const code = typeof cause.code === "string" ? cause.code : "";
  return code in HEADER_ERROR_KEYS
    ? HEADER_ERROR_KEYS[code as keyof typeof HEADER_ERROR_KEYS]
    : null;
}

/* 一次升格只有一个 requestId：终态之前的重复点击必须落在同一次尝试上，
   否则 main 侧会看见两次「新建 Project Base」的请求。 */
class PromotionAttemptFence {
  private requestId = "";

  begin(create: () => string = () => crypto.randomUUID()): string {
    this.requestId ||= create();
    return this.requestId;
  }

  settle() {
    this.requestId = "";
  }
}

export function BaseHeaderActions({
  chatId,
  projectId,
  ownerKey,
  mode,
  onClose,
}: {
  chatId?: string;
  projectId?: string | null;
  ownerKey: string;
  mode: "panel" | "page";
  onClose?: () => void;
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const bases = useBasesNavigation();
  const {
    app,
    actionError,
    actionIssues,
    actionNotice,
    busy,
    columns,
    defaultName,
    ready,
    saveChatId,
    exportCsv,
    exportJson,
    exportXlsx,
    importJson,
    importXlsx,
  } = useBaseAppActions(ownerKey, chatId);
  const [saveOpen, setSaveOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const promotionAttempt = useRef(new PromotionAttemptFence());
  const owner = ownerFromKey(ownerKey);
  const projectOwnerKey = projectId
    ? `project:${projectId}`
    : "";
  const canPromote =
    mode === "page" &&
    owner.kind === "chat" &&
    Boolean(projectOwnerKey) &&
    !bases.projectBases.some((base) => base.ownerKey === projectOwnerKey);
  const retainedBase = bases.rootBases.find(
    (base) => {
      const navigation = base.navigation;
      return base.ownerKey === ownerKey &&
        navigation?.kind === "root-user-managed" &&
        navigation.source === "retained-app-data";
    }
  );
  const promote = async () => {
    if (owner.kind !== "chat") return;
    setPromoting(true);
    const requestId = promotionAttempt.current.begin();
    try {
      const receipt = await bases.promoteToProject({
        chatId: owner.chatId,
        requestId,
      });
      setPromoteOpen(false);
      promotionAttempt.current.settle();
      void navigate(ownerRoute(receipt.ownerKey), { replace: true });
    } catch (cause) {
      promotionAttempt.current.settle();
      console.warn(
        `[bases] promotion failed ownerKey=${ownerKey}`,
        cause
      );
    } finally {
      setPromoting(false);
    }
  };
  const removeRetained = async () => {
    if (!retainedBase) return;
    setRemoving(true);
    try {
      if (
        await bases.removeManaged(
          retainedBase.ownerKey,
          retainedBase.ownerInstanceId
        )
      ) {
        setRemoveOpen(false);
        void navigate("/", { replace: true });
      }
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {actionError && (
        <span
          className="absolute top-14 right-4 z-50 max-w-sm rounded-md bg-destructive px-3 py-2 text-destructive-foreground text-sm shadow-lg"
          role="alert"
        >
          {actionError}
        </span>
      )}
      {actionNotice && (
        <div
          className="absolute top-14 right-4 z-50 max-w-sm rounded-md border bg-background px-3 py-2 text-foreground text-sm shadow-lg"
          role="status"
        >
          <p>{actionNotice}</p>
          {actionIssues.length > 0 && (
            <p className="text-muted-foreground">
              {t("bases.header.importXlsxIssues", {
                count: actionIssues.length,
              })}
            </p>
          )}
          <XlsxImportIssueDetails columns={columns} issues={actionIssues} />
        </div>
      )}
      {mode === "page" && (
        <>
          {app ? (
            <Button
              aria-label={t("bases.header.openApp")}
              asChild
              size="icon"
              title={t("bases.header.openApp")}
              variant="ghost"
            >
              <Link to={`/apps/${app.id}`}>
                <ExternalLinkIcon />
              </Link>
            </Button>
          ) : saveChatId ? (
            <Button
              aria-label={t("bases.header.saveAsApp")}
              disabled={busy || !ready}
              onClick={() => setSaveOpen(true)}
              size="icon"
              title={t("bases.header.saveAsApp")}
              type="button"
              variant="ghost"
            >
              <PackagePlusIcon />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("bases.header.importExportAria")}
                disabled={busy || !ready}
                size="icon"
                title={t("bases.header.importExport")}
                type="button"
                variant="ghost"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void exportCsv()}>
                <DownloadIcon />
                {t("bases.header.exportCsv")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportJson()}>
                <FileJsonIcon />
                {t("bases.header.exportJson")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void importJson()}>
                <ImportIcon />
                {t("bases.header.importJson")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportXlsx()}>
                <FileSpreadsheetIcon />
                {t("bases.header.exportXlsx")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void importXlsx()}>
                <FileSpreadsheetIcon />
                {t("bases.header.importXlsx")}
              </DropdownMenuItem>
              {retainedBase && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setRemoveOpen(true)}
                  >
                    <Trash2Icon />
                    {t("bases.header.deleteRetained")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canPromote && (
            <Button
              aria-label={t("bases.header.promoteAria")}
              disabled={busy || !ready}
              onClick={() => setPromoteOpen(true)}
              size="icon"
              title={t("bases.header.promote")}
              type="button"
              variant="ghost"
            >
              <DatabaseBackupIcon />
            </Button>
          )}
        </>
      )}
      {/* ── 以下两颗是栏控，不是内容操作 ──────────────────────────
          上面那组（Open App / Save / 导入导出 / Promote）作用于 Base 里的
          数据，尺寸随内容走 icon 档；这两颗改的是「这一栏在哪、还在不在」，
          与顶栏那条横带上的 SidebarTrigger、第三栏 toggle、添加面板 + 同族，
          故走 panelChromeClassName + icon-lg。两档并置不是漏改，是分组：
          在第三栏里它们接任「关闭面板」的位置，尺寸必须对得上邻座的 +。 */}
      {mode === "panel" ? (
        <Button
          aria-label={t("bases.header.openFull")}
          asChild
          className={panelChromeClassName}
          size="icon-lg"
          title={t("bases.header.openFull")}
          variant="ghost"
        >
          <Link to={ownerRoute(ownerKey)}>
            <Maximize2Icon />
          </Link>
        </Button>
      ) : (
        chatId ? (
          <Button
            aria-label={t("bases.header.collapseAria")}
            className={panelChromeClassName}
            onClick={() =>
              void navigate(`/chat/${chatId}`, { state: { openBase: true } })
            }
            size="icon-lg"
            title={t("bases.header.collapse")}
            type="button"
            variant="ghost"
          >
            <Minimize2Icon />
          </Button>
        ) : null
      )}
      <Button
        aria-label={t("bases.header.closeAria")}
        className={cn("cursor-pointer", panelChromeClassName)}
        onClick={onClose ?? (() => void navigate(chatId ? `/chat/${chatId}` : "/"))}
        size="icon-lg"
        title={t("common.close")}
        type="button"
        variant="ghost"
      >
        <XIcon />
      </Button>
      <ConfirmationDialog
        busy={promoting}
        confirmLabel={t("bases.header.promoteConfirm")}
        description={t("bases.header.promoteDescription")}
        onConfirm={() => void promote()}
        onOpenChange={setPromoteOpen}
        open={promoteOpen}
        title={t("bases.header.promoteTitle")}
      />
      <ConfirmationDialog
        busy={removing}
        confirmLabel={t("bases.header.deleteRetainedConfirm")}
        description={t("bases.header.deleteRetainedDescription")}
        onConfirm={() => void removeRetained()}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
        title={t("bases.header.deleteRetainedTitle")}
      />
      {saveChatId && (
        <SaveAsAppDialog
          chatId={saveChatId}
          defaultName={defaultName}
          onOpenChange={setSaveOpen}
          open={saveOpen}
        />
      )}
    </div>
  );
}

export function ownerRoute(ownerKey: string) {
  const owner = ownerFromKey(ownerKey);
  return owner.kind === "chat"
    ? `/bases/chat/${owner.chatId}`
    : `/bases/project/${owner.projectId}`;
}
