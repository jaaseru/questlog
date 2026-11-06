/**
 * Weather from MET Norway's Locationforecast API (the data behind yr.no).
 * Terms: https://api.met.no/doc/TermsOfService — identify the app in User-Agent, cache
 * until Expires, revalidate with If-Modified-Since, and credit "MET Norway".
 */
import { addDays, todayIn } from './dates.js';
import { HttpError } from './errors.js';

const ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

export interface DayForecast {
  date: string;
  minTemp: number | null;
  maxTemp: number | null;
  /** Total precipitation in mm. */
  precipitation: number;
  /** Highest wind speed in m/s. */
  maxWind: number | null;
  /** MET symbol code for the day, e.g. "partlycloudy_day". */
  symbol: string | null;
}

export interface WeatherReport {
  latitude: number;
  longitude: number;
  updatedAt: string;
  now: { time: string; temperature: number | null; windSpeed: number | null; symbol: string | null } | null;
  /** Today and the next three days. */
  days: DayForecast[];
}

interface Timestep {
  time: string;
  data: {
    instant: { details: { air_temperature?: number; wind_speed?: number } };
    next_1_hours?: { summary: { symbol_code: string }; details: { precipitation_amount?: number } };
    next_6_hours?: { summary: { symbol_code: string }; details: { precipitation_amount?: number } };
    next_12_hours?: { summary: { symbol_code: string } };
  };
}

export interface Forecast {
  properties: { meta: { updated_at: string }; timeseries: Timestep[] };
}

const HOUR_MS = 3_600_000;

function localHour(time: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(time);
  return Number(h);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Turns MET's time series into "now" plus a per-day summary, with days in `timeZone`. */
export function summarize(forecast: Forecast, timeZone: string, now: Date, dayCount = 4): Omit<WeatherReport, 'latitude' | 'longitude'> {
  const today = todayIn(timeZone, now);
  const wanted = Array.from({ length: dayCount }, (_, i) => addDays(today, i));
  const series = [...forecast.properties.timeseries].sort((a, b) => a.time.localeCompare(b.time));

  type Acc = { temps: number[]; winds: number[]; precip: number; symbol: string | null; symbolScore: number };
  const acc = new Map<string, Acc>(wanted.map((d) => [d, { temps: [], winds: [], precip: 0, symbol: null, symbolScore: Infinity }]));

  // Precipitation comes per 1-hour step early on and per 6-hour step later; count each hour once.
  let coveredUntil = 0;
  for (const step of series) {
    const t = new Date(step.time);
    const day = acc.get(todayIn(timeZone, t));
    if (!day) continue;
    const { air_temperature, wind_speed } = step.data.instant.details;
    if (air_temperature !== undefined) day.temps.push(air_temperature);
    if (wind_speed !== undefined) day.winds.push(wind_speed);

    if (t.getTime() >= coveredUntil) {
      if (step.data.next_1_hours) {
        day.precip += step.data.next_1_hours.details.precipitation_amount ?? 0;
        coveredUntil = t.getTime() + HOUR_MS;
      } else if (step.data.next_6_hours) {
        day.precip += step.data.next_6_hours.details.precipitation_amount ?? 0;
        coveredUntil = t.getTime() + 6 * HOUR_MS;
      }
    }

    // The day's symbol: the 6-hour outlook closest to midday says most about the day.
    const symbol =
      step.data.next_6_hours?.summary.symbol_code ??
      step.data.next_12_hours?.summary.symbol_code ??
      step.data.next_1_hours?.summary.symbol_code;
    if (symbol) {
      const score = Math.abs(localHour(t, timeZone) - 12) + (step.data.next_6_hours ? 0 : 0.5);
      if (score < day.symbolScore) {
        day.symbol = symbol;
        day.symbolScore = score;
      }
    }
  }

  const current = series.find((s) => new Date(s.time).getTime() + HOUR_MS > now.getTime()) ?? null;

  return {
    updatedAt: forecast.properties.meta.updated_at,
    now: current && {
      time: current.time,
      temperature: current.data.instant.details.air_temperature ?? null,
      windSpeed: current.data.instant.details.wind_speed ?? null,
      symbol:
        current.data.next_1_hours?.summary.symbol_code ?? current.data.next_6_hours?.summary.symbol_code ?? null,
    },
    days: wanted.map((date) => {
      const d = acc.get(date)!;
      return {
        date,
        minTemp: d.temps.length ? round1(Math.min(...d.temps)) : null,
        maxTemp: d.temps.length ? round1(Math.max(...d.temps)) : null,
        precipitation: round1(d.precip),
        maxWind: d.winds.length ? round1(Math.max(...d.winds)) : null,
        symbol: d.symbol,
      };
    }),
  };
}

/** ~1 km: precise enough for weather, vague enough not to pinpoint anyone; also improves caching. */
export function roundCoordinate(n: number): number {
  return Math.round(n * 100) / 100;
}

type Fetch = typeof fetch;

interface CacheEntry {
  forecast: Forecast;
  expires: number;
  lastModified: string | null;
}

export class WeatherService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly userAgent: string,
    private readonly timeZone: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async report(lat: number, lon: number): Promise<WeatherReport> {
    const latitude = roundCoordinate(lat);
    const longitude = roundCoordinate(lon);
    const forecast = await this.forecast(latitude, longitude);
    return { latitude, longitude, ...summarize(forecast, this.timeZone, this.clock()) };
  }

  private async forecast(lat: number, lon: number): Promise<Forecast> {
    const key = `${lat},${lon}`;
    const cached = this.cache.get(key);
    const now = this.clock().getTime();
    if (cached && cached.expires > now) return cached.forecast;

    let res: Response;
    try {
      res = await this.fetchImpl(`${ENDPOINT}?lat=${lat}&lon=${lon}`, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
          ...(cached?.lastModified ? { 'If-Modified-Since': cached.lastModified } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      if (cached) return cached.forecast; // stale is better than nothing
      throw new HttpError(502, "Couldn't reach the weather service");
    }

    const expires = Date.parse(res.headers.get('expires') ?? '') || now + 30 * 60_000;
    if (res.status === 304 && cached) {
      cached.expires = expires;
      return cached.forecast;
    }
    if (!res.ok) {
      if (cached) return cached.forecast;
      throw new HttpError(502, `The weather service answered ${res.status}`);
    }
    const forecast = (await res.json()) as Forecast;
    if (!Array.isArray(forecast?.properties?.timeseries)) {
      if (cached) return cached.forecast;
      throw new HttpError(502, 'The weather service sent an unexpected answer');
    }
    this.cache.set(key, { forecast, expires, lastModified: res.headers.get('last-modified') });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return forecast;
  }
}
