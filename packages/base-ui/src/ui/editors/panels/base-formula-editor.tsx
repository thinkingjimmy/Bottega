/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and React, shared Base formula analysis/column name mapping, i18n and the AppDialog shell/parts for the expression editor surface, state BaseMutationOutcome judgment type
 * [OUTPUT]: Provides BaseFormulaEditor, which edits formulas by column name, saves them by columnId, and announces live syntax and missing-column errors and the inferred static result type; editing clears any stale submit error
 * [POS]: Shared Base presentation in ui/editors/panels.
 */

import { useMemo, useState } from "react";
import { useAppTranslation } from "../../platform/i18n";
import {
  AppDialogBody,
  AppDialogCancel,
  AppDialogContent,
  AppDialogField,
  AppDialogFooter,
  AppDialogHeader,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import type { BaseColumn } from "@ai-chat/base-core/model/bases-ipc";
import {
  formulaExpressionForStorage,
  parseBaseFormula,
} from "@ai-chat/base-core/model/bases-ipc";
import type { BaseFormulaErrorCode } from "@ai-chat/base-core/compute/base-formula";
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
        <AppDialogHeader
          title={t("bases.formula.title")}
          description={t("bases.formula.description")}
        />
        <AppDialogBody className="mt-5 space-y-3">
          <AppDialogField
            label={t("bases.formula.expression")}
            htmlFor="base-formula-expression"
            error={visibleError ? <span role="alert">{visibleError}</span> : undefined}
          >
            <textarea
              id="base-formula-expression"
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
          </AppDialogField>
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
        </AppDialogBody>
        <AppDialogFooter>
          <AppDialogCancel disabled={busy} />
          <Button
            size="pill"
            disabled={busy || !expression.trim() || Boolean(analysis && !analysis.parsed.ok)}
            onClick={() => void submit()}
          >
            {t("bases.formula.add")}
          </Button>
        </AppDialogFooter>
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

function formulaErrorKey(code: BaseFormulaErrorCode) {
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
