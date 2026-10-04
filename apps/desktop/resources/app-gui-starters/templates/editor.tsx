/**
 * [INPUT]: Depends on React Hook Form, Zod, typed Base mutation, and Bottega form/mutation Blocks
 * [OUTPUT]: Provides the Editor/Workbench official Starter entry
 * [POS]: Production authoring template for explicit-save multi-panel editing
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useBaseMutation, useBaseRows } from "@bottega/app-react";
import { DataPage, EmptyState, ErrorState, FormFooter, LoadingState, MutationBanner } from "@bottega/app-blocks";
const schema = z.object({ title: z.string().trim().min(1).max(120), body: z.string().max(32_000) }).strict();
type Form = z.infer<typeof schema>;
type EditorRow = { rowId: string; values: Record<string, unknown> };
type EditorQuery = { rows: EditorRow[]; baseInstanceId: string; revision: number };

export default function EditorStarter() {
  const mutate = useBaseMutation();
  const rows = useBaseRows<EditorQuery>({
    shape: { version: 1, mode: "rows", projection: ["title", "body"], sort: [] },
    page: { limit: 1 },
  });
  const [outcome, setOutcome] = useState<"saved" | "optimistic" | "unknown-outcome">("saved");
  const form = useForm<Form>({ defaultValues: { title: "", body: "" }, mode: "onBlur" });
  const submit = form.handleSubmit(async (value) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      form.setError("root", { message: "Review the highlighted fields." });
      return;
    }
    if (rows.status !== "success" || !rows.data.rows[0]) {
      form.setError("root", { message: "Create a document row before saving." });
      return;
    }
    setOutcome("optimistic");
    try {
      await mutate({
        kind: "patch",
        expectedBaseInstanceId: rows.data.baseInstanceId,
        expectedRevision: rows.data.revision,
        patches: [{ rowId: rows.data.rows[0].rowId, patch: parsed.data }],
      });
      setOutcome("saved");
      form.reset(parsed.data);
    } catch {
      setOutcome("unknown-outcome");
    }
  });
  if (rows.status === "loading") return <DataPage title="Editor"><LoadingState /></DataPage>;
  if (rows.status === "error") return <DataPage title="Editor"><ErrorState action={<button className="min-h-11 rounded-md border px-4" onClick={rows.retry}>Retry</button>} /></DataPage>;
  if (!rows.data.rows.length) return <DataPage title="Editor"><EmptyState title="No document" description="Create a Base row before editing." /></DataPage>;
  return <DataPage title="Editor" description="Draft locally, then save explicitly against the current revision.">
    <MutationBanner state={outcome} onReconcile={() => location.reload()} />
    <form className="mt-4 grid min-h-0 gap-4 lg:grid-cols-[18rem_1fr]" onSubmit={submit}>
      <aside className="rounded-lg border p-4 text-sm text-muted-foreground">Document outline</aside>
      <section className="grid gap-4 rounded-lg border p-4">
        <label className="grid gap-1 text-sm">Title<input className="min-h-11 rounded-md border px-3" {...form.register("title", { required: true })} /></label>
        <label className="grid gap-1 text-sm">Body<textarea className="min-h-64 rounded-md border p-3" {...form.register("body")} /></label>
        {form.formState.errors.root && <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p>}
      </section>
      <div className="lg:col-span-2"><FormFooter dirty={form.formState.isDirty} submitting={form.formState.isSubmitting} unknownOutcome={outcome === "unknown-outcome"} onReset={() => form.reset()} /></div>
    </form>
  </DataPage>;
}
