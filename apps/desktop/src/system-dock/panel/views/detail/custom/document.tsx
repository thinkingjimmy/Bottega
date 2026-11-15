/**
 * [INPUT]: The versioned public detail document, bounded Widget readings, panel locale/translation and the shared summary icon vocabulary.
 * [OUTPUT]: Provides DocumentDetail with a tinted hero card, shared-scale range rows, reading tiles and attribution for any plugin's declared document.
 * [POS]: Lazy panel view chosen by CustomDetail whenever the snapshot carries a detail document; its stylesheet loads with it, so the eager panel CSS stays unchanged.
 */
import type { CSSProperties } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { DockDetailDocument, DockDocumentBackdrop, DockSummaryText } from '@bottega/contracts/plugins/dock/summary';
import type { DockReading } from '@bottega/contracts/plugins/dock/data';
import { readingValueText, summaryText } from '../../../../common/widgets/readings';
import { SummaryIcon, summaryIconName } from '../../../../common/widgets/summary/icons';
import type { DockT } from '../../../../common/format';
import './document.css';

const BACKDROPS = new Set<string>(['default', 'clear', 'cloudy', 'rain', 'snow', 'storm', 'fog']);
const backdropOf = (document: DockDetailDocument, readings: Readonly<Record<string, DockReading>>): DockDocumentBackdrop => {
  const bound = document.backdrop;
  if (!bound) return 'default';
  if (typeof bound === 'string') return bound;
  const value = readings[bound.source]?.values[bound.field];
  return typeof value === 'string' && BACKDROPS.has(value) ? value as DockDocumentBackdrop : 'default';
};

export default function DocumentDetail({ document, readings, locale, t }: {
  document: DockDetailDocument; readings: Readonly<Record<string, DockReading>>; locale: string; t: DockT;
}) {
  const text = (value: DockSummaryText) => summaryText(value, readings, locale);
  const { hero, rows: rowSpec } = document;
  const rows = rowSpec ? (readings[rowSpec.source]?.records ?? []).slice(0, rowSpec.max) : [];
  // One shared scale, like the Weather app: every bar is placed on the full low-to-high span.
  const lows = rows.map(row => row.values[rowSpec!.low]);
  const highs = rows.map(row => row.values[rowSpec!.high]);
  const scale = rows.length > 0 && lows.every(value => typeof value === 'number' && Number.isFinite(value))
    && highs.every(value => typeof value === 'number' && Number.isFinite(value))
    ? { low: Math.min(...lows as number[]), high: Math.max(...highs as number[]) } : null;
  const span = scale ? Math.max(1, scale.high - scale.low) : 1;
  return <div className="dock-document" data-detail-document="" data-backdrop={backdropOf(document, readings)}>
    <section className="document-sky" aria-label={text(hero.title)}>
      <h2 className="document-sky-title">{text(hero.title)}</h2>
      <p className="document-sky-value" data-document-hero-value="">{text(hero.value)}</p>
      {hero.caption && <p className="document-sky-caption">{text(hero.caption)}</p>}
      {(hero.high || hero.low) && <p className="document-sky-range">
        {hero.high && <span><ArrowUp aria-hidden="true" />{text(hero.high)}</span>}
        {hero.low && <span><ArrowDown aria-hidden="true" />{text(hero.low)}</span>}
      </p>}
    </section>
    {rows.length > 0 && <ol className="document-rows">
      {rows.map(row => {
        const icon = summaryIconName(row.values[rowSpec!.icon]);
        const low = row.values[rowSpec!.low], high = row.values[rowSpec!.high];
        const range = scale && typeof low === 'number' && typeof high === 'number' ? { low, high } : null;
        return <li key={row.id} data-document-row="">
          <span className="document-row-title">{readingValueText(row.values[rowSpec!.title], locale)}</span>
          {icon ? <SummaryIcon name={icon} /> : <span className="document-row-icon" aria-hidden="true" />}
          <span className="document-row-low">{readingValueText(low, locale, rowSpec!.format)}</span>
          <span className="document-row-bar" aria-hidden="true"
            style={range ? { '--from': `${(range.low - scale!.low) / span * 100}%`, '--to': `${(scale!.high - range.high) / span * 100}%` } as CSSProperties : { visibility: 'hidden' }} />
          <span className="document-row-high">{readingValueText(high, locale, rowSpec!.format)}</span>
        </li>;
      })}
    </ol>}
    {document.tiles?.length ? <dl className="document-tiles">
      {document.tiles.map((tile, index) => <div key={index} data-document-tile={index}><dt>{text(tile.label)}</dt><dd>{text(tile.value)}</dd></div>)}
    </dl> : null}
    {document.attribution && <p className="document-source">{t('systemDock.widgets.api.attribution', { name: document.attribution.label })}</p>}
  </div>;
}
