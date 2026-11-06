import { addDays } from '../dates';
import { describeSymbol, formatTemp, useWeather, useWeatherLocation, type DayForecast } from '../weather';

interface Props {
  date: string;
  today: string;
}

const FORECAST_DAYS = 3;

/**
 * Today: the weather now and the rest of today.
 * The next three days' pages: that day's forecast. Other days: nothing.
 */
export function WeatherCard({ date, today }: Props) {
  const isToday = date === today;
  const inRange = date >= today && date <= addDays(today, FORECAST_DAYS);
  const { pref, state, enable, disable, retry } = useWeatherLocation();
  const coords = state.status === 'ready' ? state.coords : state.status === 'locating' ? state.coords : null;
  const weather = useWeather(coords);

  if (!inRange) return null;

  if (state.status === 'off') {
    // Only offer it on today's page, and not again once declined.
    if (!isToday || pref === 'off') return null;
    return (
      <section className="weather weather--prompt" aria-label="Weather">
        <span className="weather__prompt-emoji" aria-hidden>
          ⛅
        </span>
        <p>See the weather for where you are on today's page and the next three days.</p>
        <div className="row">
          <button className="btn btn--primary btn--small" onClick={enable}>
            Use my location
          </button>
          <button className="btn btn--ghost btn--small" onClick={disable}>
            Not now
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'denied' || state.status === 'unavailable') {
    if (!isToday) return null;
    return (
      <section className="weather weather--prompt" aria-label="Weather">
        <p className="muted">
          {state.status === 'denied'
            ? 'Location access is blocked for this site. Allow it in your browser settings to see the weather.'
            : "Couldn't find your location."}
        </p>
        <div className="row">
          <button className="btn btn--small" onClick={retry}>
            Try again
          </button>
          <button className="btn btn--ghost btn--small" onClick={disable}>
            Turn off weather
          </button>
        </div>
      </section>
    );
  }

  if (!weather.data) {
    if (!isToday) return null;
    return (
      <section className="weather" aria-label="Weather" aria-busy={!weather.isError}>
        <p className="muted">{weather.isError ? "Couldn't load the weather right now." : 'Loading weather…'}</p>
      </section>
    );
  }

  const { days, now } = weather.data;
  const day = days.find((d) => d.date === date);
  if (!day) return null;

  if (!isToday) {
    const { emoji, label } = describeSymbol(day.symbol);
    return (
      <section className="weather weather--compact" aria-label={`Weather forecast: ${label}`}>
        <span className="weather__emoji" aria-hidden>
          {emoji}
        </span>
        <div className="weather__main">
          <strong>{label}</strong>
          <DayDetails day={day} />
        </div>
        <Credit />
      </section>
    );
  }

  const current = describeSymbol(now?.symbol ?? day.symbol);

  return (
    <section className="weather" aria-label="Weather">
      <div className="weather__today">
        <span className="weather__emoji weather__emoji--big" aria-hidden>
          {current.emoji}
        </span>
        <div className="weather__main">
          <div className="weather__now">
            <span className="weather__temp">{formatTemp(now?.temperature ?? null)}</span>
            <span>{current.label}</span>
          </div>
          <DayDetails day={day} />
        </div>
      </div>
      <Credit />
    </section>
  );
}

function DayDetails({ day }: { day: DayForecast }) {
  return (
    <span className="weather__details muted">
      <span>
        {formatTemp(day.minTemp)} – {formatTemp(day.maxTemp)}
      </span>
      <span>💧 {day.precipitation.toFixed(1)} mm</span>
      {day.maxWind !== null && <span>💨 {Math.round(day.maxWind)} m/s</span>}
    </span>
  );
}

function Credit() {
  return (
    <a className="weather__credit" href="https://www.yr.no/" target="_blank" rel="noreferrer">
      Weather data from MET Norway (yr.no)
    </a>
  );
}
