/**
 * [INPUT]: Trusted Weather search IPC, loaded Dock copy and the form's selected city.
 * [OUTPUT]: WeatherCityField with a keyboard-accessible city search and a compact selected-city row.
 * [POS]: Local form control; query and result state last only for the active city search.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { MapPin, Search } from 'lucide-react';
import { Button } from '@ai-chat/ui/components/ui/button';
import { Input } from '@ai-chat/ui/components/ui/input';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import type { WeatherCity } from '../../../../../../shared/system-dock/widgets/weather';
import '@/lib/platform/system-dock-settings-client';
import './weather-form.css';

type CityFieldProps = {
  city: WeatherCity | null;
  editing: boolean;
  disabled: boolean;
  onSelect(city: WeatherCity): void;
  onEdit(editing: boolean): void;
};

export function WeatherCityField({ city, editing, disabled, onSelect, onEdit }: CityFieldProps) {
  const { t } = useAppTranslation();
  const id = useId();
  const searching = editing || !city;
  const input = useRef<HTMLInputElement>(null), changeButton = useRef<HTMLButtonElement>(null);
  const wasSearching = useRef(searching);

  useLayoutEffect(() => {
    if (wasSearching.current === searching) return;
    wasSearching.current = searching;
    (searching ? input.current : changeButton.current)?.focus();
  }, [searching]);

  return <div className="weather-city-field" data-weather-location="">
    <div className="weather-city-label">
      {searching
        ? <label htmlFor={id} className="text-sm font-medium">{t('systemDock.weather.city')}</label>
        : <span className="text-sm font-medium">{t('systemDock.weather.city')}</span>}
      {city && searching && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onEdit(false)}>
        {t('systemDock.weather.cancelCityChange')}
      </Button>}
    </div>
    {searching ? <CitySearch id={id} input={input} disabled={disabled} onSelect={onSelect} /> :
      <div className="weather-city-selected" data-weather-selected="">
        <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <CityText city={city} />
        <Button ref={changeButton} type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onEdit(true)}>
          {t('systemDock.weather.changeCity')}
        </Button>
      </div>}
  </div>;
}

function CityText({ city }: { city: WeatherCity }) {
  const region = [city.region, city.country].filter(place => place && place !== city.name).join(', ');
  return <span className="weather-city-text">
    <span className="text-sm leading-tight font-medium">{city.name}</span>
    {region && <span className="text-xs leading-tight text-muted-foreground">{region}</span>}
  </span>;
}

type CitySearchResult = { term: string } & ({ cities: WeatherCity[] } | { failed: true });
const NO_CITIES: WeatherCity[] = [];

function CitySearch({ id, input, disabled, onSelect }: {
  id: string;
  input: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onSelect(city: WeatherCity): void;
}) {
  const { t } = useAppTranslation();
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<CitySearchResult | null>(null);
  const term = query.trim();
  const result = response?.term === term ? response : null;
  const pending = term.length >= 2 && result === null;
  const cities = result && 'cities' in result ? result.cities : NO_CITIES;
  const failed = result !== null && 'failed' in result;

  useEffect(() => {
    if (term.length < 2) return;
    let live = true, requestId: string | undefined;
    const bridge = window.systemDockSettings;
    const timer = setTimeout(async () => {
      try {
        if (!bridge) throw new Error('Weather search is unavailable');
        requestId = crypto.randomUUID();
        const reply = await bridge.weatherControl({ kind: 'search', requestId, query: term });
        if (live) setResponse(reply.kind === 'cities' ? { term, cities: reply.cities } : { term, failed: true });
      } catch {
        if (live) setResponse({ term, failed: true });
      } finally {
        requestId = undefined;
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
      if (requestId) void bridge?.weatherControl({ kind: 'cancel', requestId }).catch(() => undefined);
    };
  }, [term, retry]);

  return <Combobox.Root<WeatherCity>
    inline open disabled={disabled} items={cities} filter={null} value={null} inputValue={query}
    itemToStringLabel={city => city.name}
    onValueChange={city => { if (city) onSelect(city); }}
    onInputValueChange={value => {
      setQuery(value);
      if (value.trim() !== term) setResponse(null);
    }}>
    <div className="weather-search-field">
      <Search aria-hidden="true" className="weather-search-icon" />
      <Combobox.Input
        id={id} ref={input} type="search" render={<Input size="lg" />}
        placeholder={t('systemDock.weather.search')}
        spellCheck={false} autoComplete="off" maxLength={160}
      />
    </div>
    <Combobox.List className="weather-city-results" aria-busy={pending}>
      {(city: WeatherCity) => <Combobox.Item key={city.id} value={city} data-weather-city={city.id}
        className="weather-city-option">
        <CityText city={city} />
      </Combobox.Item>}
    </Combobox.List>
    <Combobox.Status className="weather-search-status text-xs text-muted-foreground">
      {pending ? t('systemDock.weather.searching') : result && !failed && !cities.length ? t('systemDock.weather.noCities') : null}
    </Combobox.Status>
    {failed && <div className="flex flex-wrap items-center gap-x-2">
      <p role="alert" className="text-xs text-destructive">{t('systemDock.weather.searchFailed')}</p>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => {
        setResponse(null);
        setRetry(count => count + 1);
        input.current?.focus();
      }}>{t('common.retry')}</Button>
    </div>}
  </Combobox.Root>;
}
