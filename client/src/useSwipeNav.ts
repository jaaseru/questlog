import { useEffect, type RefObject } from 'react';

interface Options {
  /** Called after a swipe to the left (finger moves left): go forward. */
  onNext: () => void;
  /** Called after a swipe to the right: go back. */
  onPrev: () => void;
}

const EDGE = 24; // px from the screen edge reserved for the phone's own gestures
const LOCK = 12; // px of movement before deciding horizontal vs vertical
const DISTANCE = 0.22; // share of the screen width that counts as a swipe
const FLICK = 0.45; // px per ms; a quick flick counts even if short

/**
 * Horizontal swipe navigation for touch screens. The element follows the finger while
 * swiping; vertical scrolling is untouched. Ignored inside text fields and dialogs.
 */
export function useSwipeNav(ref: RefObject<HTMLElement | null>, { onNext, onPrev }: Options) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let start: { x: number; y: number; t: number } | null = null;
    let horizontal: boolean | null = null;
    let dx = 0;

    const reset = (animate: boolean) => {
      el.style.transition = animate && !reduceMotion ? 'transform 180ms ease-out' : '';
      el.style.transform = '';
    };

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      const target = e.target as HTMLElement;
      if (
        e.touches.length !== 1 ||
        !touch ||
        target.closest('input, textarea, select, dialog, [contenteditable]') ||
        touch.clientX < EDGE ||
        touch.clientX > window.innerWidth - EDGE
      ) {
        start = null;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY, t: e.timeStamp };
      horizontal = null;
      dx = 0;
      el.style.transition = '';
    };

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!start || !touch) return;
      dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (horizontal === null && Math.max(Math.abs(dx), Math.abs(dy)) > LOCK) {
        horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
      }
      if (!horizontal) return;
      e.preventDefault(); // we own this gesture: don't scroll
      if (!reduceMotion) el.style.transform = `translateX(${dx * 0.5}px)`;
    };

    const onEnd = (e: TouchEvent) => {
      if (!start || !horizontal) {
        start = null;
        return;
      }
      const speed = Math.abs(dx) / Math.max(1, e.timeStamp - start.t);
      const far = Math.abs(dx) > window.innerWidth * DISTANCE;
      start = null;
      if (far || (speed > FLICK && Math.abs(dx) > 40)) {
        reset(false);
        if (dx < 0) onNext();
        else onPrev();
      } else {
        reset(true); // not far enough: spring back
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', () => reset(true), { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      reset(false);
    };
  }, [ref, onNext, onPrev]);
}
