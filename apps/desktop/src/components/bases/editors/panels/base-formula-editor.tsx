"use client";

/**
 * [INPUT]: Depends on React, shared Base formula analysis/column name mapping, i18n and Unified Dialog/Button expression monologue, state BaseMutationOutcome judgment type
 * [OUTPUT]: Provides BaseFormulaEditor; Edit by column name, save by columnId, and show in real time syntax/unknown dependence errors and static result types, editing is to remove old submit errors
 * [POS]: the formula configuration surface of bases/editors/panels; Only output the formula data, without writing a value or directly contacting the Provider
 */

import { useMemo, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type { BaseColumn } from "../../../../../shared/bases-ipc";
import {
  formulaExpressionForStorage,
  parseBaseFormula,
} from "../../../../../shared/bases-ipc";
import type { BaseFormulaErrorCode } from "../../../../../shared/base-formula";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";

export function BaseFormulaEditor({
  columns,
  open,
  onOpenChange,
  onSubmit,
}: {
  columns: BaseColumn[];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** workbench 收口 intent：判决即返回值，永不 reject */
  onSubmit(
    formula: NonNullable<BaseColumn["formula"]>
  ): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const [expression, setExpression] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const analysis = useMemo(() => {
    if (!expression.trim()) return null;
    try {
      const storage = formulaExpressionForStorage(expression, columns);
      const parsed = parseBaseFormula(storage, columns);
      if (
        parsed.ok &&
        parsed.value.dependencies.some(
          (columnId) => !columns.some((column) => column.id === columnId)
        )
      ) {
        return {
          storage,
          parsed: {
            ok: false as const,
            error: "#REF!" as const,
            message: "",
          },
        };
      }
      return { storage, parsed };
    } catch (cause) {
      return {
        storage: "",
        parsed: {
          ok: false as const,
          error: formulaErrorCode(cause),
          message: "",
        },
      };
    }
  }, [columns, expression]);
  const analysisError = analysis && !analysis.parsed.ok
    ? t(formulaErrorKey(analysis.parsed.error))
    : "";
  const visibleError = analysisError || submitError;
  const submit = async () => {
    setSubmitError("");
    if (!analysis?.parsed.ok) return;
    setBusy(true);
    /* intent 永不 reject：判决非空即失败，就地显示的与顶部横幅是同一份文案，
       对话框留在原地供改完重试。 */
    const error = await onSubmit({
      expression: analysis.storage,
      resultType: analysis.parsed.value.resultType,
    });
    setBusy(false);
    if (error) setSubmitError(error);
    else onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AppDialogContent>
        <DialogHeader className="text-left">
          <DialogTitle>{t("bases.formula.title")}</DialogTitle>
          <DialogDescription>
            {t("bases.formula.description")}
          </DialogDescription>
        </DialogHeader>
        <AppDialogBody className="mt-5 space-y-3">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{t("bases.formula.expression")}</span>
            <textarea
              autoFocus
              className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={busy}
              maxLength={4_096}
              placeholder={'ROUND({Amount} * 1.2, 2)'}
              value={expression}
              onChange={(event) => {
                setExpression(event.target.value);
                setSubmitError("");
              }}
            />
          </label>
          <p className="text-muted-foreground text-xs">
            {t("bases.formula.columns", {
              columns: columns.map((column) => `{${column.name}}`).join(", ") || "—",
            })}
          </p>
          {analysis?.parsed.ok && (
            <p className="text-muted-foreground text-xs" role="status">
              {t("bases.formula.result", {
                type: t(`bases.formula.resultType.${analysis.parsed.value.resultType}`),
              })}
            </p>
          )}
          {visibleError && (
            <p role="alert" className="text-destructive text-xs">
              {visibleError}
            </p>
          )}
        </AppDialogBody>
        <DialogFooter className="mt-5">
          <Button disabled={busy} onClick={() => onOpenChange(false)} variant="ghost">
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !expression.trim() || Boolean(analysis && !analysis.parsed.ok)}
            onClick={() => void submit()}
          >
            {t("bases.formula.add")}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}

const FORMULA_ERROR_KEYS = {
  "#REF!": "bases.formula.error.ref",
  "#DIV/0!": "bases.formula.error.div",
  "#TYPE!": "bases.formula.error.type",
  "#ERROR!": "bases.formula.error.syntax",
  "#LIMIT!": "bases.formula.error.limit",
} as const;

export function formulaErrorKey(code: BaseFormulaErrorCode) {
  return FORMULA_ERROR_KEYS[code];
}

function formulaErrorCode(cause: unknown): BaseFormulaErrorCode {
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = cause.code;
    if (typeof code === "string" && code in FORMULA_ERROR_KEYS) {
      return code as BaseFormulaErrorCode;
    }
  }
  return "#ERROR!";
}
