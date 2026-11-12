/**
 * [INPUT]: Dock edge preferences, intrinsic widget geometry, selected city and the shared Weather face.
 * [OUTPUT]: WeatherSizeField with native size radios and local example previews for all three sizes.
 * [POS]: Final field in the official Weather form; samples create no live weather demand.
 */
import { useId } from 'react';
import { DOCK_SUMMARY_SIZES, summaryDimensions, type DockSummarySize } from '@bottega/contracts/plugins/dock/geometry';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { WeatherFace } from '@/system-dock/common/widgets/weather';
import type { DockEdge } from '../../../../../../shared/system-dock/local-state';
import type { WeatherFaceReading } from '../../../../../../shared/system-dock/widgets/weather/forecast';
import './weather-form.css';

const LABELS = {
  small: 'systemDock.widgets.sizeSmall', medium: 'systemDock.widgets.sizeMedium', large: 'systemDock.widgets.sizeLarge',
} as const;
const DESCRIPTIONS = {
  small: 'systemDock.weather.sizeCurrent', medium: 'systemDock.weather.sizeToday', large: 'systemDock.weather.sizeForecast',
} as const;
const EXAMPLE: Omit<WeatherFaceReading, 'city'> = {
  temperature: 23, code: 2,
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
  const reading = { ...EXAMPLE, city: city ?? t('systemDock.weather.city') };

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
              <WeatherFace reading={reading} size={size} edge={edge} locale={i18n.language} t={t} />
            </span>
            <span id={`${description}-label`} className="text-xs font-medium">{t(LABELS[size])}</span>
          </span>
          <span id={description} className="sr-only">{t(DESCRIPTIONS[size])}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}
