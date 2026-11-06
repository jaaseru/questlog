import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface DayForecast {
  date: string;
  minTemp: number | null;
  maxTemp: number | null;
  precipitation: number;
  maxWind: number | null;
  symbol: string | null;
}

export interface WeatherReport {
  latitude: number;
  longitude: number;
  updatedAt: string;
  now: { time: string; temperature: number | null; windSpeed: number | null; symbol: string | null } | null;
  days: DayForecast[];
}

// ---------- Symbols ----------

/** Emoji and an English label for a MET symbol code such as "lightrainshowers_day". */
export function describeSymbol(code: string | null): { emoji: string; label: string } {
  if (!code) return { emoji: '·', label: 'No forecast' };
  const [base = '', variant] = code.split('_');
  const night = variant === 'night' || variant === 'polartwilight';
  const emoji = base.includes('thunder')
    ? '⛈️'
    : base.includes('snow') || base.includes('sleet')
      ? '🌨️'
      : base.includes('rainshowers')
        ? '🌦️'
        : base.includes('rain')
          ? '🌧️'
          : base === 'fog'
            ? '🌫️'
            : base === 'cloudy'
              ? '☁️'
              : base === 'partlycloudy'
                ? night
                  ? '☁️'
                  : '⛅'
                : base === 'fair'
                  ? night
                    ? '🌙'
                    : '🌤️'
                  : base === 'clearsky'
                    ? night
                      ? '🌙'
                      : '☀️'
                    : '🌡️';
  return { emoji, label: symbolLabel(base) };
}

const WORDS: [string, string][] = [
  ['clearsky', 'clear sky'],
  ['partlycloudy', 'partly cloudy'],
  ['andthunder', ' and thunder'],
  ['showers', ' showers'],
  ['light', 'light '],
  ['heavy', 'heavy '],
];

function symbolLabel(base: string): string {
  let s = base;
  for (const [from, to] of WORDS) s = s.replace(from, to);
  s = s.replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatTemp(t: number | null): string {
  return t === null ? '–' : `${Math.round(t)}°`;
}

// ---------- Location & preference (per device) ----------

const PREF_KEY = 'ql:weather';
const COORDS_KEY = 'ql:weather-coords';

type Pref = 'on' | 'off' | null;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference just won't stick */
  }
}

export type LocationState =
  | { status: 'off' } // never asked, or turned off
  | { status: 'locating'; coords: Coords | null }
  | { status: 'ready'; coords: Coords }
  | { status: 'denied' }
  | { status: 'unavailable' };

export interface Coords {
  lat: number;
  lon: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function savedCoords(): Coords | null {
  try {
    const c = JSON.parse(read(COORDS_KEY) ?? 'null');
    return typeof c?.lat === 'number' && typeof c?.lon === 'number' ? c : null;
  } catch {
    return null;
  }
}

/**
 * The device's approximate location, only after the user has turned weather on.
 * Coordinates are rounded to ~1 km and remembered on this device so the card shows at once.
 */
export function useWeatherLocation() {
  const [pref, setPref] = useState<Pref>(() => read(PREF_KEY) as Pref);
  const [state, setState] = useState<LocationState>(() =>
    pref === 'on' ? { status: 'locating', coords: savedCoords() } : { status: 'off' },
  );

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) return setState({ status: 'unavailable' });
    setState((s) => ({ status: 'locating', coords: s.status === 'locating' ? s.coords : savedCoords() }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: round2(pos.coords.latitude), lon: round2(pos.coords.longitude) };
        write(COORDS_KEY, JSON.stringify(coords));
        setState({ status: 'ready', coords });
      },
      (err) => {
        const fallback = savedCoords();
        if (err.code === err.PERMISSION_DENIED) setState({ status: 'denied' });
        else if (fallback) setState({ status: 'ready', coords: fallback });
        else setState({ status: 'unavailable' });
      },
      { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 15_000 },
    );
  }, []);

  useEffect(() => {
    if (pref === 'on') locate();
  }, [pref, locate]);

  const enable = () => {
    write(PREF_KEY, 'on');
    setPref('on');
  };
  const disable = () => {
    write(PREF_KEY, 'off');
    write(COORDS_KEY, null);
    setPref('off');
    setState({ status: 'off' });
  };

  return { pref, state, enable, disable, retry: locate };
}

export function useWeather(coords: Coords | null) {
  return useQuery({
    queryKey: ['weather', coords?.lat, coords?.lon],
    queryFn: () => api.weather(coords!.lat, coords!.lon),
    enabled: coords !== null,
    staleTime: 15 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: 1,
  });
}
