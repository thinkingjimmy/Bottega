/**
 * [INPUT]: Dock edge preferences, intrinsic widget geometry, selected city and the shared Weather summary projection.
 * [OUTPUT]: WeatherSizeField with native size radios and local example previews for all three sizes.
 * [POS]: Final field in the official Weather form; samples create no live weather demand.
 */
import { useId } from 'react';
import { DOCK_SUMMARY_SIZES, summaryDimensions, type DockSummarySize } from '@bottega/contracts/plugins/dock/geometry';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { DockSummary } from '@/system-dock/common/widgets/summary';
import type { DockEdge } from '../../../../../../shared/system-dock/local-state';
import { weatherLayouts, weatherReadings, type WeatherPresentationReading } from '../../../../../../shared/system-dock/widgets/weather/presentation';
import './weather-form.css';

const LABELS = {
  small: 'systemDock.widgets.sizeSmall', medium: 'systemDock.widgets.sizeMedium', large: 'systemDock.widgets.sizeLarge',
} as const;
const DESCRIPTIONS = {
  small: 'systemDock.weather.sizeCurrent', medium: 'systemDock.weather.sizeToday', large: 'systemDock.weather.sizeForecast',
} as const;
const LAYOUTS = weatherLayouts();
const EXAMPLE: WeatherPresentationReading = {
  temperature: 23, code: 2, feelsLike: 24, humidity: 60, observedAt: 0,
  today: { date: '2026-11-11', code: 2, high: 25, low: 18 },
  upcoming: [
    { date: '2026-11-12', code: 0, high: 26, low: 18 },
    { date: '2026-11-13', code: 61, high: 22, low: 16 },
    { date: '2026-11-14', code: 3, high: 24, low: 17 },
  ],
};

export function WeatherSizeField({ value, city, edge, disabled, onChange }: {
  value: DockSummarySize;
  city: string | undefined;
  edge: DockEdge;
  disabled: boolean;
  onChange(size: DockSummarySize): void;
}) {
  const { t, i18n } = useAppTranslation();
  const group = useId();
  const readings = weatherReadings(EXAMPLE, city ?? t('systemDock.weather.city'), i18n.language);

  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-2 text-sm font-medium">
      {t('systemDock.settings.size')}
      <span className="weather-size-example text-xs font-normal text-muted-foreground">{t('systemDock.widgets.example')}</span>
    </legend>
    <div className="weather-size-choices">
      {DOCK_SUMMARY_SIZES.map(size => {
        const description = `${group}-${size}`;
        return <label key={size} className="weather-size-choice">
          <input type="radio" className="sr-only" name={group} value={size} checked={value === size}
            aria-labelledby={`${description}-label`} aria-describedby={description} onChange={() => onChange(size)} />
          <span className="weather-size-tile">
            <span className="weather-size-preview"
              style={summaryDimensions(size, edge)} aria-hidden="true">
              <span className="weather-size-face"><DockSummary node={LAYOUTS[size]} readings={readings} locale={i18n.language} size={size} edge={edge} /></span>
            </span>
            <span id={`${description}-label`} className="text-xs font-medium">{t(LABELS[size])}</span>
          </span>
          <span id={description} className="sr-only">{t(DESCRIPTIONS[size])}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}
