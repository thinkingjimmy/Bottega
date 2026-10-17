/**
 * [INPUT]: Fixed version, CM source capabilities, the original edit controller and explicit text-session handoff.
 * [OUTPUT]: Capability-bound property inputs with explicit text ownership and original-operation conflict recovery.
 * [POS]: Contextual inspector; shared validators define properties and main owns all mutations.
 */
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { designPropertySchema } from "@ai-chat/cloud-protocol/artifacts/design/review";
import type { CanvasTarget } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useArtifactHost } from "../../../../../context";
import { canvasCopy } from "../../copy";
import { colorHex } from "./typography";
import type { DesignEdit, DesignEditController } from "../../../edits";
const spacingNames: Record<string, string[]> = { en: ["Background color", "Padding", "Gap"], zh: ["背景颜色", "内边距", "间距"], ja: ["背景色", "余白", "間隔"], es: ["Color de fondo", "Relleno", "Separación"], fr: ["Couleur de fond", "Marge interne", "Écart"] };
const choices = { "font-weight": ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000"], "font-style": ["normal", "italic", "oblique"], "text-decoration": ["none", "underline", "line-through", "underline line-through"], "text-align": ["start", "center", "end", "justify", "left", "right"] };
export function DesignProperties({ artifactId, state, controls, selected, boardId, target, fonts = [], onTextInput }: { artifactId: string; state: WorkspaceRead; controls: DesignEditController; selected: boolean; boardId: string; target?: CanvasTarget; fonts?: string[]; onTextInput(): void }) {
  const host = useArtifactHost()!, copy = canvasCopy(host.locale), language = host.locale.startsWith("zh") ? "zh" : host.locale.split("-")[0]!, spacing = spacingNames[language] ?? spacingNames.en!;
  const labels: Record<DesignEdit["property"], string> = { text: copy.text, color: copy.color, "background-color": spacing[0]!, "font-size": copy.fontSize, padding: spacing[1]!, gap: spacing[2]!, width: copy.width, height: copy.height, "font-family": copy.font, "font-weight": copy.bold, "font-style": copy.italic, "text-decoration": copy.underline, "text-align": copy.align, "line-height": copy.lineHeight, "letter-spacing": copy.letterSpacing, left: "X", top: "Y" };
  const { edit, current, busy, pending, error, change } = controls, { anchor, property, value } = edit, allowed = target ? target.editable && target.properties.includes(property) : !state.canvas && ["text", "color", "background-color", "font-size", "padding", "gap", "width", "height"].includes(property);
  const currentValue = target?.values[property] || (property === "text" ? anchor?.currentText : anchor?.properties?.[property]);
  const mutate = (value: string) => { if (property === "text") onTextInput(); change({ ...edit, value }); };
  const options = property === "font-family" ? fonts : choices[property as keyof typeof choices];
  return <fieldset className="flex min-w-0 flex-col gap-4 p-4" disabled={busy}>
    <legend className="sr-only">{copy.properties}</legend>
    {anchor ? <div className="min-w-0"><p className="text-xs text-muted-foreground">{copy.selected}</p><p className="mt-1 truncate font-medium" title={anchor.selector ?? copy.region}>{anchor.currentText.slice(0, 80) || anchor.selector || copy.region}</p><p className="truncate text-xs text-muted-foreground">{state.manifest.boards.find(board => board.id === anchor.boardId)?.title}</p><details className="mt-2 text-xs text-muted-foreground"><summary>{copy.sourceTarget}</summary><p className="break-all">{anchor.selector ?? copy.region}</p>{target?.reason && <p>{target.reason}</p>}</details></div> : <p role="status" className="text-sm text-muted-foreground">{copy.choose}</p>}
    {!current && <p role="status" className="rounded-md bg-muted p-2 text-xs text-muted-foreground">{state.enabled ? state.dirty ? copy.dirty : copy.readonly : copy.off}</p>}
    {(anchor || edit.sourceConflict || controls.canvasDraft?.sourceConflict) && <>
      <select aria-label={copy.property} disabled={!current || pending} className="min-h-[44px] w-full rounded-md border bg-background px-2 text-sm" value={property} onChange={event => {
        const property = designPropertySchema.parse(event.target.value); if (property === "text") onTextInput(); change({ ...edit, property, value: target?.values[property] || (property === "text" ? anchor?.currentText : anchor?.properties?.[property]) || "" });
      }}>{designPropertySchema.options.map(property => <option key={property} value={property} disabled={Boolean(target && !target.properties.includes(property))}>{labels[property]}</option>)}</select>
      <label className="flex min-w-0 flex-col gap-2 text-sm"><span>{labels[property]}</span><div className="flex min-w-0 items-center gap-2">
        {(property === "color" || property === "background-color") && <input type="color" aria-label={labels[property]} disabled={!current || !allowed || pending} value={colorHex(value)} className="size-11 shrink-0 cursor-pointer rounded-md border bg-background p-1" onChange={event => mutate(event.target.value)} />}
        {options ? <select aria-label={copy.value} value={value} disabled={!current || !allowed || pending} className="min-h-[44px] min-w-0 flex-1 rounded-md border bg-background px-2" onChange={event => mutate(event.target.value)}>{!options.includes(value) && <option value={value}>{value || copy.none}</option>}{options.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input aria-label={copy.value} value={value} disabled={!current || !allowed || pending} maxLength={4096} inputMode={!["text", "color", "background-color"].includes(property) ? "decimal" : undefined} className="min-h-[44px] min-w-0 flex-1 rounded-md border bg-background px-3" onChange={event => mutate(event.target.value)} />}
      </div></label>
      {currentValue !== undefined && <p className="break-words text-xs text-muted-foreground">{copy.currentValue}: {currentValue.slice(0, 160)}</p>}
      <Button type="button" className="min-h-[44px]" disabled={!current || !allowed || !selected || anchor?.boardId !== boardId || !anchor?.selector?.startsWith("#") || pending} onClick={() => void controls.save(artifactId)}>{copy.save}</Button>
      {anchor && !allowed && <p className="text-xs text-muted-foreground">{copy.unsupported}</p>}
    </>}
    {(edit.sourceConflict || controls.canvasDraft?.sourceConflict) && <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><p>{(edit.sourceConflict ?? controls.canvasDraft?.sourceConflict)?.needsResolution ? copy.partialSourceChanged : copy.sourceChanged}</p>
      {(edit.sourceConflict ?? controls.canvasDraft?.sourceConflict)?.needsResolution && <Button type="button" variant="outline" disabled={!state.enabled || !edit.request && !controls.canvasDraft?.request} className="min-h-[44px]" onClick={() => void controls.recover(true)}>{copy.keepCurrentSource}</Button>}</div>}
    {(error || pending && !edit.sourceConflict && !controls.canvasDraft?.sourceConflict) && <div role={error ? "alert" : "status"} className="flex flex-col gap-2 text-sm"><p>{error || copy.checking}</p>{(edit.request || controls.canvasDraft?.request) && <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => void controls.recover()}>{copy.retry}</Button>}</div>}
  </fieldset>;
}
