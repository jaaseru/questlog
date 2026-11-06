import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { roundCoordinate, summarize, WeatherService, type Forecast } from '../src/weather.js';

// A real Locationforecast response for Oslo, fetched 2026-11-06 ~09:55 UTC.
const oslo = JSON.parse(readFileSync(new URL('./fixtures/met-oslo.json', import.meta.url), 'utf8')) as Forecast;
const fetchedAt = new Date('2026-11-06T10:00:00Z');

function step(time: string, temp: number, wind: number, extra: Record<string, unknown> = {}) {
  return { time, data: { instant: { details: { air_temperature: temp, wind_speed: wind } }, ...extra } };
}
const hour = (symbol: string, mm: number) => ({ summary: { symbol_code: symbol }, details: { precipitation_amount: mm } });

describe('summarize', () => {
  it('produces today plus three days from a real response', () => {
    const r = summarize(oslo, 'Europe/Oslo', fetchedAt);
    expect(r.days.map((d) => d.date)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
    for (const d of r.days) {
      expect(d.minTemp).not.toBeNull();
      expect(d.maxTemp!).toBeGreaterThanOrEqual(d.minTemp!);
      expect(d.precipitation).toBeGreaterThanOrEqual(0);
      expect(d.symbol).toMatch(/^[a-z]+(_day|_night|_polartwilight)?$/);
    }
    expect(r.now).toMatchObject({ time: '2026-11-06T10:00:00Z' });
    expect(r.updatedAt).toBe('2026-11-06T09:29:37Z');
  });

  it('groups by local day, counts each hour of rain once, and picks the midday symbol', () => {
    const forecast: Forecast = {
      properties: {
        meta: { updated_at: '2026-11-06T00:00:00Z' },
        timeseries: [
          // 23:00 UTC on the 5th is 00:00 on the 6th in Oslo.
          step('2026-11-05T23:00:00Z', 1, 2, { next_1_hours: hour('cloudy', 0.5), next_6_hours: hour('cloudy', 3) }),
          step('2026-11-06T00:00:00Z', 2, 4, { next_1_hours: hour('rain', 1), next_6_hours: hour('rain', 4) }),
          step('2026-11-06T11:00:00Z', 6, 3, { next_1_hours: hour('fair_day', 0), next_6_hours: hour('partlycloudy_day', 0.2) }),
          // Further out: 6-hour steps only.
          step('2026-11-07T05:00:00Z', -1, 7, { next_6_hours: hour('snow', 2) }),
          step('2026-11-07T11:00:00Z', 0, 9, { next_6_hours: hour('lightsnow', 1.5) }),
        ],
      },
    };
    const r = summarize(forecast, 'Europe/Oslo', new Date('2026-11-05T23:10:00Z'), 2);
    expect(r.days).toEqual([
      { date: '2026-11-06', minTemp: 1, maxTemp: 6, precipitation: 1.5, maxWind: 4, symbol: 'partlycloudy_day' },
      { date: '2026-11-07', minTemp: -1, maxTemp: 0, precipitation: 3.5, maxWind: 9, symbol: 'lightsnow' },
    ]);
    expect(r.now).toMatchObject({ temperature: 1, symbol: 'cloudy' });
  });

  it('returns empty days when the forecast does not reach them', () => {
    const r = summarize({ properties: { meta: { updated_at: 'x' }, timeseries: [] } }, 'UTC', fetchedAt, 2);
    expect(r.days[1]).toEqual({ date: '2026-11-07', minTemp: null, maxTemp: null, precipitation: 0, maxWind: null, symbol: null });
    expect(r.now).toBeNull();
  });
});

describe('roundCoordinate', () => {
  it('rounds to two decimals (~1 km)', () => {
    expect(roundCoordinate(59.913868)).toBe(59.91);
    expect(roundCoordinate(-10.756)).toBe(-10.76);
  });
});

describe('WeatherService', () => {
  function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(status === 304 ? null : JSON.stringify(body), { status, headers });
  }

  it('identifies itself, rounds coordinates, caches until Expires, then revalidates', async () => {
    let now = fetchedAt;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      respond(200, oslo, { expires: 'Fri, 06 Nov 2026 10:30:00 GMT', 'last-modified': 'Fri, 06 Nov 2026 09:55:11 GMT' }),
    );
    const service = new WeatherService('questlog-test (+contact)', 'Europe/Oslo', fetchImpl as typeof fetch, () => now);

    const report = await service.report(59.913868, 10.752245);
    expect(report).toMatchObject({ latitude: 59.91, longitude: 10.75 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=59.91&lon=10.75');
    expect((init!.headers as Record<string, string>)['User-Agent']).toBe('questlog-test (+contact)');

    await service.report(59.9139, 10.7522); // same rounded spot, not expired
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = new Date('2026-11-06T10:31:00Z');
    fetchImpl.mockResolvedValueOnce(respond(304, null, { expires: 'Fri, 06 Nov 2026 11:00:00 GMT' }));
    await service.report(59.91, 10.75);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1]![1]!.headers as Record<string, string>)['If-Modified-Since']).toBe(
      'Fri, 06 Nov 2026 09:55:11 GMT',
    );
    await service.report(59.91, 10.75);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('serves the last forecast when the service is down, and fails clearly without one', async () => {
    let now = fetchedAt;
    const fetchImpl = vi.fn(async () => respond(200, oslo, { expires: 'Fri, 06 Nov 2026 10:05:00 GMT' }));
    const service = new WeatherService('ua', 'UTC', fetchImpl as unknown as typeof fetch, () => now);
    await service.report(1, 1);
    now = new Date('2026-11-06T11:00:00Z');
    fetchImpl.mockResolvedValueOnce(respond(503, {}));
    await expect(service.report(1, 1)).resolves.toMatchObject({ latitude: 1 });
    fetchImpl.mockRejectedValueOnce(new Error('network down'));
    await expect(service.report(1, 1)).resolves.toMatchObject({ latitude: 1 });

    fetchImpl.mockResolvedValueOnce(respond(429, {}));
    await expect(service.report(2, 2)).rejects.toMatchObject({ status: 502 });
  });
});
