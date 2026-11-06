/**
 * Layout preview: lets the "A" and "B" layout proposals be tried without changing the default.
 * Turn on with ?layout=a or ?layout=b (remembered on this device); ?layout=classic turns it off.
 */
import { useSyncExternalStore } from 'react';

export type LayoutVariant = 'classic' | 'a' | 'b';
const KEY = 'ql:layout';

function read(): LayoutVariant {
  try {
    const fromUrl = new URLSearchParams(location.search).get('layout');
    if (fromUrl === 'a' || fromUrl === 'b' || fromUrl === 'classic') {
      localStorage.setItem(KEY, fromUrl);
      return fromUrl;
    }
    const saved = localStorage.getItem(KEY);
    return saved === 'a' || saved === 'b' ? saved : 'classic';
  } catch {
    return 'classic';
  }
}

const current: LayoutVariant = read();

/** Applies the layout to <html data-layout>, which the CSS keys off. */
export function applyLayout(): void {
  document.documentElement.dataset.layout = current;
}

export function useLayout(): LayoutVariant {
  return useSyncExternalStore(
    () => () => {},
    () => current,
    () => current,
  );
}
