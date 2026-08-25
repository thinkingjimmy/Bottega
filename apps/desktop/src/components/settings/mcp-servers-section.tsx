/**
 * [INPUT]: Depends on React, i18n, Settings, UI AppDialog with Dialog, shared masked MCP DTO and mcp-servers-client
 * [OUTPUT]: Provides McpServersSection: list manager activate/delete, add and edit a shared pop-up window (masked env replacement/delete) with honest inclusion alerts
 * [POS]: The manual MCP control panel for Settings › Tools; Only edit stdio, remote recording only show fail-closed eligibility
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Server, Trash2 } from "lucide-react";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Textarea } from "@ai-chat/ui/components/ui/textarea";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type {
  ManualMcpServerView,
  McpServerView,
  McpSecretEdit,
  McpServersSnapshot,
  SaveManualMcpServerInput,
} from "../../../shared/mcp-servers-ipc";
import {
  SettingsAlert,
  SettingsButton,
  SettingsEmpty,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import {
  hasMcpServersBridge,
  listManualMcpServers,
  onManualMcpServersChanged,
  removeManualMcpServer,
  saveManualMcpServer,
} from "@/lib/mcp-servers-client";
import { errorMessage } from "@/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { TFunction } from "i18next";

const EMPTY: McpServersSnapshot = { revision: 0, servers: [] };

type EnvRow = {
  rowId: number;
  name: string;
  originalName?: string;
  value: string;
};

type FormState = {
  serverId?: `manual:${string}`;
  displayName: string;
  enabled: boolean;
  command: string;
  args: string;
  env: EnvRow[];
};

let rowId = 0;
const nextRowId = () => ++rowId;
const blankForm = (): FormState => ({
  displayName: "",
  enabled: true,
  command: "",
  args: "",
  env: [],
});

export function McpServersSection() {
  const { t } = useAppTranslation();
  const [snapshot, setSnapshot] = useState<McpServersSnapshot>(EMPTY);
  const [draft, setDraft] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasMcpServersBridge()) return;
    let active = true;
    void listManualMcpServers()
      .then((value) => active && setSnapshot(value))
      .catch((cause: unknown) => active && setError(errorMessage(cause)));
    const stop = onManualMcpServersChanged(
      (value) => active && setSnapshot(value)
    );
    return () => {
      active = false;
      stop();
    };
  }, []);

  const run = useCallback(async (task: () => Promise<McpServersSnapshot>) => {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await task());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const toggle = (server: ManualMcpServerView, enabled: boolean) =>
    run(() =>
      saveManualMcpServer({
        expectedRevision: snapshot.revision,
        serverId: server.serverId,
        draft: viewDraft(server, enabled),
      })
    );

  return (
    <SettingsSection
      title={t("settings.tools.mcp.title")}
      description={t("settings.tools.mcp.description")}
      action={
        /* 表单搬进弹窗后，「已经在填一张表」不再需要在这里防守：
           模态遮罩替这颗按钮挡住了那次点击，一个分支就此消失。 */
        <SettingsButton
          disabled={busy || !hasMcpServersBridge()}
          onClick={() => setDraft(blankForm())}
          variant="outline"
        >
          <Plus className="size-4" />
          {t("settings.tools.mcp.add")}
        </SettingsButton>
      }
      alert={error || undefined}
    >
      {snapshot.servers.length ? (
        <SettingsList>
          {snapshot.servers.map((server) => (
            <SettingsRow
              control={
                <div className="flex items-center gap-1">
                  {server.source === "manual" && server.transport === "stdio" && (
                    <SettingsButton
                      disabled={busy}
                      onClick={() => setDraft(formFrom(server))}
                      variant="ghost"
                    >
                      {t("settings.tools.mcp.edit")}
                    </SettingsButton>
                  )}
                  {server.source === "manual" && <button
                    aria-label={t("settings.tools.mcp.delete", {
                      name: server.displayName,
                    })}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        removeManualMcpServer({
                          expectedRevision: snapshot.revision,
                          serverId: server.serverId,
                        })
                      )
                    }
                    type="button"
                  >
                    <Trash2 className="size-4" />
                  </button>}
                  {server.source === "manual" ? <SettingsSwitch
                    checked={server.enabled}
                    disabled={busy || (!server.enabled && server.eligibility !== "eligible")}
                    id={`mcp-server-${server.serverId}`}
                    /* 状态归 aria-checked，标签只说这是谁 */
                    label={server.displayName}
                    onToggle={(enabled) => void toggle(server, enabled)}
                  /> : <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{t("settings.tools.mcp.packageBadge")}</span>}
                </div>
              }
              description={serverDescription(server, t)}
              htmlFor={`mcp-server-${server.serverId}`}
              key={server.serverId}
              label={server.displayName}
            />
          ))}
        </SettingsList>
      ) : (
        <SettingsEmpty
          hint={t("settings.tools.mcp.emptyHint")}
          icon={<Server />}
          title={t("settings.tools.mcp.emptyTitle")}
        />
      )}

      <McpServerDialog
        expectedRevision={snapshot.revision}
        onOpenChange={(next) => !next && setDraft(null)}
        onSaved={(next) => {
          setSnapshot(next);
          setDraft(null);
        }}
        seed={draft}
      />
    </SettingsSection>
  );
}

/* ── 一张表两个入口，只差一颗种子 ──────────────────────────────────
 * 新增与编辑填的是同一张表，差别只有初值：`serverId` 为空即新增，
 * 非空即改这一台。于是不必有两个组件，只需要一颗可空的种子。
 *
 * 它从前是列表上方一块常驻的内联卡片：一打开就把整张列表往下顶，
 * 而人此刻要读的恰恰是那张列表（改哪一台、旁边那台叫什么）。更麻烦的是
 * 「正在填表」得由页面记着——段头那颗「添加」于是要多一条 `Boolean(form)`
 * 才不会开出第二张表。模态把这两件事一并解决：表在自己的层里，
 * 列表原地不动；遮罩天然挡住第二次点击，那条分支不必再写。
 *
 * 面板独立成 `McpServerPanel` 挂在 `AppDialogContent` 内——Radix 关闭即
 * 卸载，于是每次打开都是全新一张表，生命周期本身就是重置，没有任何
 * reset 分支，上一次填了一半的 command 也不会漏进下一次编辑。
 * ─────────────────────────────────────────────────────────── */

function McpServerDialog({
  seed,
  expectedRevision,
  onOpenChange,
  onSaved,
}: {
  /** null 即关闭；serverId 为空是新增，非空是编辑那一台 */
  seed: FormState | null;
  expectedRevision: number;
  onOpenChange: (next: boolean) => void;
  onSaved: (snapshot: McpServersSnapshot) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={seed !== null}>
      <AppDialogContent className="sm:max-w-[34rem]">
        {seed && (
          <McpServerPanel
            expectedRevision={expectedRevision}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
            seed={seed}
          />
        )}
      </AppDialogContent>
    </Dialog>
  );
}

function McpServerPanel({
  seed,
  expectedRevision,
  onCancel,
  onSaved,
}: {
  seed: FormState;
  expectedRevision: number;
  onCancel: () => void;
  onSaved: (snapshot: McpServersSnapshot) => void;
}) {
  const { t } = useAppTranslation();
  /* 表单状态住在面板里，不再上抛给页面：敲一个字符只重渲染这张表，
     身后那份 server 列表与它无关，从前却跟着每一次击键重画一遍。 */
  const [form, setForm] = useState(seed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (value: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...value }));

  const save = async () => {
    let env: McpSecretEdit[];
    try {
      env = envEdits(form.env, t);
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(
        await saveManualMcpServer({
          expectedRevision,
          ...(form.serverId ? { serverId: form.serverId } : {}),
          draft: {
            displayName: form.displayName,
            enabled: form.enabled,
            config: {
              transport: "stdio",
              command: form.command,
              args: form.args.split("\n").filter((value) => value.length > 0),
              env,
            },
          },
        })
      );
    } catch (cause) {
      /* 失败的结论必须留在人眼睛所在的那一层：页面此刻在遮罩后面，
         错误若还上抛给段头，就说给了一个没人看的地方。
         成功不复位 busy——面板随即卸载，没有「之后」需要恢复。 */
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader className="shrink-0 gap-0 text-left">
        <DialogTitle className="font-semibold text-lg">
          {seed.serverId
            ? t("settings.tools.mcp.editTitle")
            : t("settings.tools.mcp.addTitle")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-muted-foreground text-xs">
          {t("settings.tools.mcp.dialogDescription")}
        </DialogDescription>
      </DialogHeader>

      <AppDialogBody className="mt-4 space-y-4">
        {error && <SettingsAlert>{error}</SettingsAlert>}
        <Field label={t("settings.tools.mcp.name")} htmlFor="mcp-display-name">
          <Input
            autoFocus
            disabled={busy}
            id="mcp-display-name"
            onChange={(event) => patch({ displayName: event.target.value })}
            value={form.displayName}
          />
        </Field>
        <Field label={t("settings.tools.mcp.command")} htmlFor="mcp-command">
          <Input
            disabled={busy}
            id="mcp-command"
            onChange={(event) => patch({ command: event.target.value })}
            placeholder={"/opt/homebrew/bin/node"}
            value={form.command}
          />
        </Field>
        <Field label={t("settings.tools.mcp.args")} htmlFor="mcp-args">
          <Textarea
            disabled={busy}
            id="mcp-args"
            onChange={(event) => patch({ args: event.target.value })}
            value={form.args}
          />
        </Field>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium text-xs">
              {t("settings.tools.mcp.environment")}
            </p>
            <SettingsButton
              disabled={busy}
              onClick={() =>
                patch({
                  env: [...form.env, { rowId: nextRowId(), name: "", value: "" }],
                })
              }
              variant="ghost"
            >
              {t("settings.tools.mcp.addVariable")}
            </SettingsButton>
          </div>
          {form.env.map((row) => (
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2" key={row.rowId}>
              <Input
                aria-label={t("settings.tools.mcp.envName")}
                disabled={busy}
                onChange={(event) => patchEnv(form, row.rowId, { name: event.target.value }, patch)}
                placeholder={"VARIABLE_NAME"}
                value={row.name}
              />
              <Input
                aria-label={t("settings.tools.mcp.envNewValue", {
                  name: row.name || t("settings.tools.mcp.envFallbackName"),
                })}
                disabled={busy}
                onChange={(event) => patchEnv(form, row.rowId, { value: event.target.value }, patch)}
                placeholder={
                  row.originalName
                    ? t("settings.tools.mcp.retainValue")
                    : t("settings.tools.mcp.value")
                }
                type="password"
                value={row.value}
              />
              <button
                aria-label={t("settings.tools.mcp.removeVariable", {
                  name: row.name || t("settings.tools.mcp.envFallbackName"),
                })}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                disabled={busy}
                onClick={() => patch({ env: form.env.filter((item) => item.rowId !== row.rowId) })}
                type="button"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </AppDialogBody>

      <DialogFooter className="mt-5 shrink-0 flex-row justify-end gap-3">
        <SettingsButton disabled={busy} onClick={onCancel} variant="ghost">
          {t("common.cancel")}
        </SettingsButton>
        <SettingsButton disabled={busy} onClick={() => void save()}>
          {t("common.save")}
        </SettingsButton>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="font-medium text-xs" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function patchEnv(
  form: FormState,
  target: number,
  value: Partial<EnvRow>,
  patch: (value: Partial<FormState>) => void
) {
  patch({
    env: form.env.map((row) => (row.rowId === target ? { ...row, ...value } : row)),
  });
}

function envEdits(rows: EnvRow[], t: TFunction): McpSecretEdit[] {
  return rows.map((row) => {
    const name = row.name.trim();
    if (!name) throw new Error(t("settings.tools.mcp.envNameRequired"));
    if (row.originalName === name && row.value === "") {
      return { name, action: "keep" };
    }
    if (row.value === "") {
      throw new Error(t("settings.tools.mcp.envValueRequired", { name }));
    }
    return { name, action: "replace", value: row.value };
  });
}

function formFrom(server: Extract<ManualMcpServerView, { transport: "stdio" }>): FormState {
  return {
    serverId: server.serverId,
    displayName: server.displayName,
    enabled: server.enabled,
    command: server.command,
    args: server.args.join("\n"),
    env: server.env.map((value) => ({
      rowId: nextRowId(),
      name: value.name,
      originalName: value.name,
      value: "",
    })),
  };
}

function viewDraft(
  server: ManualMcpServerView,
  enabled: boolean
): SaveManualMcpServerInput["draft"] {
  if (server.transport === "stdio") {
    return {
      displayName: server.displayName,
      enabled,
      config: {
        transport: "stdio",
        command: server.command,
        args: server.args,
        env: server.env.map(({ name }) => ({ name, action: "keep" })),
      },
    };
  }
  return {
    displayName: server.displayName,
    enabled,
    config: {
      transport: server.transport,
      url: server.url,
      headers: server.headers.map(({ name }) => ({ name, action: "keep" })),
    },
  };
}

function serverDescription(server: McpServerView, t: TFunction) {
  const target = server.source === "package"
    ? server.target
    : server.transport === "stdio" ? server.command : server.url;
  return t("settings.tools.mcp.descriptionLine", {
    transport: server.transport,
    target,
    eligibility: t(
      `settings.tools.mcp.eligibility.${server.eligibility}`
    ),
    health: t(`settings.tools.mcp.health.${server.health.state}`),
  });
}
