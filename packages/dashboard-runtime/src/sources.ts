/**
 * [INPUT]: Independently validated fixed dataset rows, bounded opaque calculation facts and explicit user file actions.
 * [OUTPUT]: Host-owned Sources list, real paged rows, provenance/formula/input views and atomic file operations.
 * [POS]: Dedicated Dashboard source presentation; page markup never becomes trusted panel HTML.
 */
import { dashboardCopy as copy, dashboardLocale } from "./copy";
import { dashboardIcon } from "./icons";
export type Dataset = { id: string; columns: string[]; data: Record<string, string>[]; meta: { title: string; description?: string; updated: { at: string; by: string }; fixed?: boolean; source: { url: string; name: string; format?: string } } };
export type Calculation = { id: string; inputs: string[]; title: string; description: string; formula: string; status: string; data: unknown; message?: string };
export type Attachment = { id: string; name: string; contentType: string; bytes: number; used: boolean };
export type Material = { attachments: Attachment[]; title: string; html: string; pageDigest: string; revision: number; snapshotRef: string; datasets: Record<string, Dataset>; documents: Record<string, Record<string, unknown>> };
export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
export const button = (text: string, action: () => void, label?: string) => { const node = element("button", text); node.type = "button"; if (label) node.setAttribute("aria-label", label); node.onclick = action; return node; };
export function createSources(root: HTMLElement, ports: { material(): Material; calculations(): Map<string, Calculation>; add(file: File): Promise<string>; attach(file: File): Promise<void>; deleteFile(id: string): Promise<void>; replace(id: string, file: File): Promise<void>; remove(id: string): Promise<void>; close(): void; error(message: string): void }) {
  let working = false, selected = "", page = 0, search = "", citation: { field?: string; row?: string; where?: string } = {};
  const perform = (work: () => Promise<void>) => {
    if (working) return; working = true; render();
    void work().catch(cause => ports.error(cause instanceof Error ? cause.message : "The file could not be saved")).finally(() => { working = false; render(); });
  };
  const choose = (label: string, accept: string, action: (file: File) => Promise<void>) => {
    const input = element("input"); input.type = "file"; input.accept = accept; input.setAttribute("aria-label", label); input.disabled = working;
    input.hidden = true;
    input.onchange = () => { const file = input.files?.[0]; if (file) perform(() => action(file)); };
    const control = button(label, () => input.click()); control.disabled = working;
    const picker = element("div", undefined, "dash-upload"); picker.append(control, input); return picker;
  };
  function table(columns: string[], data: Record<string, unknown>[]) {
    const filter = element("input"); filter.type = "search"; filter.placeholder = copy().find; filter.setAttribute("aria-label", copy().find); filter.value = search;
    filter.oninput = () => { search = filter.value; page = 0; render(); const next = root.querySelector<HTMLInputElement>('input[type="search"]'); next?.focus(); next?.setSelectionRange(search.length, search.length); };
    const rows = data.map((row, index) => ({ row, index })).filter(({ row, index }) => {
      if (citation.row !== undefined && String(index) !== citation.row) return false;
      if (citation.where) { try { for (const [key, value] of new URLSearchParams(citation.where)) if (String(row[key] ?? "") !== value) return false; } catch { return false; } }
      return !search || columns.some(column => String(row[column] ?? "").toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    });
    const wrapper = element("div", undefined, "dash-table-wrap"), grid = element("table"), header = element("thead"), headerRow = element("tr"), body = element("tbody");
    for (const column of columns) { const cell = element("th", column); cell.scope = "col"; if (column === citation.field) cell.className = "dash-highlight"; headerRow.append(cell); }
    header.append(headerRow); grid.append(header, body); wrapper.append(grid);
    for (const { row, index } of rows.slice(page * 50, page * 50 + 50)) { const line = element("tr"); line.dataset.sourceRow = String(index); for (const column of columns) { const cell = element("td", String(row[column] ?? "")); if (column === citation.field) cell.className = "dash-highlight"; line.append(cell); } body.append(line); }
    const status = element("p", rows.length ? `${rows.length.toLocaleString(dashboardLocale())} ${copy().rows} · ${columns.length} ${copy().columns} · ${page * 50 + 1}–${Math.min(rows.length, page * 50 + 50)}` : copy().noRows, "dash-muted");
    const controls = element("div", undefined, "dash-row"); const previous = button(copy().previous, () => { page--; render(); }), next = button(copy().next, () => { page++; render(); }); previous.disabled = page === 0; next.disabled = (page + 1) * 50 >= rows.length; controls.append(previous, next);
    return [filter, wrapper, status, controls];
  }
  function render() {
    const material = ports.material(), datasets = Object.values(material.datasets), calculations = [...ports.calculations().values()]; root.replaceChildren(); root.setAttribute("aria-label", copy().sources);
    const heading = element("div", undefined, "dash-source-heading"); heading.append(element("h2", copy().sources), button("×", ports.close, copy().closeSources)); root.append(heading);
    const layout = element("div", undefined, "dash-source-layout"), list = element("nav"), detail = element("section"); list.setAttribute("aria-label", copy().dataSources);
    for (const source of [...datasets.map(dataset => ({ id: dataset.id, title: dataset.meta.title })), ...calculations.map(calc => ({ id: calc.id, title: calc.title }))]) { const entry = button(source.title, () => { selected = source.id; citation = {}; page = 0; search = ""; render(); }); entry.setAttribute("aria-pressed", String(source.id === selected)); entry.append(dashboardIcon(material.datasets[source.id] ? "file" : "calculation")); list.append(entry); }
    if (!selected) layout.append(list); else detail.append(button("← " + copy().allSources, () => { selected = ""; page = 0; citation = {}; render(); }));
    layout.append(detail); root.append(layout);
    if (!selected) {
      detail.append(element("p", datasets.length ? copy().selectSource : copy().empty, "dash-muted"));
      detail.append(element("h3", copy().addSource), choose(copy().addSource, ".csv,.tsv,.json", async file => { selected = await ports.add(file); page = 0; search = ""; citation = {}; }));
      detail.append(element("h3", copy().files), choose(copy().addFile, ".csv,.tsv,.json,.png,.jpg,.jpeg,.webp,.gif,.svg,.woff2,.woff,.ttf,.otf,.txt,.md", file => ports.attach(file)));
      for (const file of material.attachments ?? []) {
        const row = element("article", undefined, "dash-file");
        const name = button(file.name, () => { void navigator.clipboard.writeText("/_blob/" + file.id).catch(cause => ports.error(cause.message)); }, copy().copyPath + ": " + file.name);
        const remove = button(copy().deleteFile, () => perform(() => ports.deleteFile(file.id)), copy().deleteFile + ": " + file.name); remove.disabled = working || file.used;
        row.append(name, element("p", `${file.bytes.toLocaleString(dashboardLocale())} B · ${file.used ? copy().usedFile : copy().unusedFile}`, "dash-muted"), remove); detail.append(row);
      }
      return;
    }
    const dataset = material.datasets[selected], calc = ports.calculations().get(selected);
    if (dataset) {
      detail.append(element("h3", dataset.meta.title), element("p", dataset.meta.description ?? copy().noDescription));
      const at = new Date(dataset.meta.updated.at); detail.append(element("p", `${dataset.meta.source.name} · ${Number.isFinite(at.getTime()) ? at.toLocaleString(dashboardLocale()) : dataset.meta.updated.at} · ${dataset.meta.updated.by}${dataset.meta.fixed ? " · " + copy().fixed : ""}`, "dash-muted"));
      const upload = choose(copy().replace, ".csv,.tsv,.json", file => ports.replace(dataset.id, file));
      const remove = button(copy().remove, () => perform(async () => { await ports.remove(dataset.id); selected = ""; })); remove.disabled = working;
      detail.append(upload, remove, ...table(dataset.columns, dataset.data));
    } else if (calc) {
      detail.append(element("h3", calc.title), element("p", calc.description), element("p", copy().calculation, "dash-muted"));
      for (const id of calc.inputs) detail.append(button(material.datasets[id]?.meta.title ?? ports.calculations().get(id)?.title ?? id, () => { selected = id; page = 0; citation = {}; render(); }));
      detail.append(element("pre", calc.formula, "dash-formula"));
      if (calc.status !== "ok") detail.append(element("p", calc.message ?? copy().notRun, "dash-error"));
      else if (Array.isArray(calc.data) && calc.data.every(row => row && typeof row === "object" && !Array.isArray(row))) { const rows = calc.data as Record<string, unknown>[]; const columns = [...new Set(rows.flatMap(row => Object.keys(row)))]; detail.append(...table(columns, rows)); }
      else detail.append(element("pre", JSON.stringify(calc.data, null, 2), "dash-result"));
    } else detail.append(element("p", copy().missing, "dash-error"));
  }
  return { render, select(ids: string[], hint: typeof citation = {}) { const material = ports.material(); const id = ids.find(id => material.datasets[id] || ports.calculations().has(id)); if (!id) { ports.error(copy().invalidMark); return; } selected = id; citation = hint; page = 0; search = ""; render(); } };
}
