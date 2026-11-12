/**
 * [INPUT]: Normalized Weather readings, Dock geometry, translation and Lucide weather icons.
 * [OUTPUT]: WeatherFace with distinct current, daily range and three-day presentations on every Dock edge.
 * [POS]: Shared native Dock, catalog and settings preview renderer.
 */
import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, CloudSunRain, Sun,
} from 'lucide-react';
import type { DockSummarySize } from '@bottega/contracts/plugins/dock/geometry';
import type { DockEdge } from '../../../../../shared/system-dock/local-state';
import {
  weatherConditionKey, weatherDaysForSize, weatherWeekday, type WeatherFaceReading,
} from '../../../../../shared/system-dock/widgets/weather/forecast';
import type { DockT } from '../../format';
import './styles.css';

const ICONS = {
  clear: Sun, partlyCloudy: CloudSun, cloudy: Cloud, fog: CloudFog, drizzle: CloudDrizzle,
  rain: CloudRain, snow: CloudSnow, showers: CloudSunRain, thunderstorm: CloudLightning, unknown: Cloud,
};

function ConditionIcon({ condition }: { condition: ReturnType<typeof weatherConditionKey> }) {
  const Icon = ICONS[condition];
  return <Icon aria-hidden="true" data-condition={condition} className="weather-condition-icon" strokeWidth={1.8} />;
}

export function WeatherFace({ reading, size, edge, locale, t }: {
  reading: WeatherFaceReading;
  size: DockSummarySize;
  edge: DockEdge;
  locale: string;
  t: DockT;
}) {
  const condition = weatherConditionKey(reading.code);
  const days = weatherDaysForSize(reading, size);
  return <span className="weather-face" data-weather-face={size} data-edge={edge} aria-hidden="true">
    <span className="weather-current">
      <span className="weather-city">{reading.city}</span>
      <span className="weather-temperature">{Math.round(reading.temperature)}°<small>C</small></span>
      <span className="weather-condition-line">
        <ConditionIcon condition={condition} />
        <span className="weather-caption">{t(`systemDock.weather.${condition}`)}</span>
      </span>
    </span>
    {size !== 'small' && <span className="weather-forecast">
      {days.length === 0 && <span className="weather-unavailable">{t('systemDock.weather.forecastUnavailable')}</span>}
      {days.map(day => <span className="weather-day" key={day.date} data-weather-day={day.date}>
        <span className="weather-day-name">{size === 'medium' ? t('systemDock.weather.today') : weatherWeekday(day.date, locale)}</span>
        <ConditionIcon condition={weatherConditionKey(day.code)} />
        <span className="weather-range" data-weather-range="">
          <span>{Math.round(day.high)}° / </span><span className="weather-low">{Math.round(day.low)}°</span>
        </span>
      </span>)}
    </span>}
  </span>;
}
