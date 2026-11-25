import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * Drag-to-reorder for a vertical list, by a handle. Works with touch, mouse and pen
 * (pointer events), and with the keyboard (arrow keys on the handle).
 *
 * While dragging, the row follows the pointer and the rows it passes slide out of the way;
 * nothing is reordered until the drop, which calls `onMove(id, beforeId)` (`beforeId` null =
 * move to the end). The caller updates its data; the hook only handles the gesture.
 */
export function useDragReorder(ids: string[], onMove: (id: string, beforeId: string | null) => void) {
  const rows = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const commit = useCallback(
    (id: string, to: number) => {
      const order = ids.filter((x) => x !== id);
      order.splice(to, 0, id);
      if (order.every((x, i) => x === ids[i])) return;
      onMove(id, order[to + 1] ?? null);
    },
    [ids, onMove],
  );

  const rowRef = (id: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };

  const rowStyle = (id: string): CSSProperties | undefined => {
    if (!drag) return undefined;
    const i = ids.indexOf(id);
    if (id === drag.id) return { transform: `translateY(${drag.dy}px)` };
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return { transform: `translateY(${-drag.shift}px)` };
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return { transform: `translateY(${drag.shift}px)` };
    return undefined;
  };

  const rowClass = (id: string) => (!drag ? '' : id === drag.id ? ' is-dragging' : ' is-shifting');

  const handleProps = (id: string) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || ids.length < 2) return;
      e.preventDefault();
      const rects = ids.map((x) => rows.current.get(x)?.getBoundingClientRect());
      if (rects.some((r) => !r)) return;
      const from = ids.indexOf(id);
      const r = rects as DOMRect[];
      // Distance between neighbouring rows, so a passed row moves by the dragged row's size plus the gap.
      const gap = r.length > 1 ? Math.max(0, r[1]!.top - r[0]!.bottom) : 0;
      e.currentTarget.setPointerCapture(e.pointerId);
      navigator.vibrate?.(10);
      setDrag({ id, from, to: from, dy: 0, startY: e.clientY, rects: r, shift: r[from]!.height + gap });
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.id !== id) return;
      const dy = e.clientY - d.startY;
      const me = d.rects[d.from]!;
      const center = me.top + me.height / 2 + dy;
      let to = d.from;
      for (let j = d.from + 1; j < d.rects.length && center > mid(d.rects[j]!); j++) to = j;
      for (let j = d.from - 1; j >= 0 && center < mid(d.rects[j]!); j--) to = j;
      setDrag({ ...d, dy, to });
    },
    onPointerUp: () => {
      const d = dragRef.current;
      if (!d || d.id !== id) return;
      setDrag(null);
      commit(d.id, d.to);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const i = ids.indexOf(id);
      if (e.key === 'ArrowUp' && i > 0) commit(id, i - 1);
      else if (e.key === 'ArrowDown' && i < ids.length - 1) commit(id, i + 1);
      else return;
      e.preventDefault();
    },
  });

  return { rowRef, rowStyle, rowClass, handleProps, dragging: drag !== null };
}

interface Drag {
  id: string;
  from: number;
  to: number;
  dy: number;
  startY: number;
  rects: DOMRect[];
  shift: number;
}

const mid = (r: DOMRect) => r.top + r.height / 2;
