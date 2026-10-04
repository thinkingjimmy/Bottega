/**
 * [INPUT]: Depends on the public SDK record UI client and the HTML form.
 * [OUTPUT]: Shows the selected record and saves a review into its results.
 * [POS]: Isolated browser example with no Chat, native bridge or arbitrary network access.
 */
import { openRecordUi } from "@bottega/sdk/record-ui";
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const report = document.querySelector<HTMLTextAreaElement>("#report")!;
const save = document.querySelector<HTMLButtonElement>("#save")!;
try {
  const client = await openRecordUi();
  const record = await client.request({ operation: "base.record.read", payload: {} });
  const selected = record as { rows: { fields: Record<string, unknown> }[] };
  document.querySelector("#record")!.textContent = JSON.stringify(selected.rows[0]?.fields ?? {}, null, 2);
  const settings = await client.request({ operation: "plugin.settings.read", payload: {} }) as { values?: Record<string, unknown> };
  const label = typeof settings.values?.label === "string" && settings.values.label.trim() ? settings.values.label : "Review";
  document.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); void client.close(); } });
  status.textContent = "This action can read only the record you opened and its results.";
  save.disabled = false;
  let requestId = crypto.randomUUID();
  report.addEventListener("input", () => { requestId = crypto.randomUUID(); });
  save.addEventListener("click", async () => {
    if (!report.value.trim()) { report.focus(); return; }
    save.disabled = true; report.disabled = true;
    try {
      await client.request({ operation: "base.results.report", payload: { requestId, label, report: report.value } });
      status.textContent = "Review saved. Open this record’s results to read it.";
    } catch (cause) { status.textContent = String(cause); }
    finally { save.disabled = false; report.disabled = false; }
  });
} catch (cause) { status.textContent = String(cause); }
