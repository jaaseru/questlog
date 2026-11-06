import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { CheckIcon, PlusIcon, SubItemIcon, XIcon } from '../components/icons';
import { timeAgo } from '../dates';
import { useMe, useUsers } from '../queries';
import type { ShoppingItem } from '../types';

const KEY = ['shopping'];
type ListData = { items: ShoppingItem[]; retentionHours: number };

/** Optimistically applies a check/uncheck the way the server will (the refetch settles the rest). */
function applyToggle(items: ShoppingItem[], id: string, checked: boolean, userId: string): ShoppingItem[] {
  const target = items.find((i) => i.id === id);
  if (!target) return items;
  const now = new Date().toISOString();
  const set = (i: ShoppingItem): ShoppingItem =>
    checked ? { ...i, checkedAt: i.checkedAt ?? now, checkedBy: i.checkedBy ?? userId } : { ...i, checkedAt: null, checkedBy: null };
  return items.map((i) => {
    if (i.id === id) return set(i);
    if (target.parentId === null && i.parentId === id) return set(i); // an item takes its sub-items along
    if (!checked && target.parentId === i.id) return set(i); // unchecking a sub-item reopens its item
    return i;
  });
}

export function ShoppingPage() {
  const qc = useQueryClient();
  const me = useMe();
  const { byId } = useUsers();
  // Shared list: pick up other people's changes while it's open.
  const { data, error, isPending } = useQuery({ queryKey: KEY, queryFn: api.shopping.list, refetchInterval: 15_000 });
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const settle = () => qc.invalidateQueries({ queryKey: KEY });
  const toggle = useMutation({
    mutationFn: ({ id, checked }: { id: string; checked: boolean }) =>
      checked ? api.shopping.check(id) : api.shopping.uncheck(id),
    onMutate: async ({ id, checked }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<ListData>(KEY);
      if (previous) qc.setQueryData<ListData>(KEY, { ...previous, items: applyToggle(previous.items, id, checked, me.id) });
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && qc.setQueryData(KEY, ctx.previous),
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.shopping.remove(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<ListData>(KEY);
      if (previous) {
        qc.setQueryData<ListData>(KEY, { ...previous, items: previous.items.filter((i) => i.id !== id && i.parentId !== id) });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && qc.setQueryData(KEY, ctx.previous),
    onSettled: settle,
  });

  const items = data?.items ?? [];
  const children = (id: string) => items.filter((i) => i.parentId === id);
  const topLevel = items.filter((i) => i.parentId === null);
  const open = topLevel.filter((i) => !i.checkedAt);
  // Checked group: checked items (with their sub-items), plus sub-items checked off on their own.
  const checked = items
    .filter((i) => i.checkedAt && (i.parentId === null || !items.find((p) => p.id === i.parentId)?.checkedAt))
    .sort((a, b) => b.checkedAt!.localeCompare(a.checkedAt!));

  const removeItem = (item: ShoppingItem) => {
    const subs = children(item.id).length;
    if (subs && !confirm(`Remove "${item.title}" and its ${subs} sub-item${subs === 1 ? '' : 's'}?`)) return;
    remove.mutate(item.id);
  };

  const rowProps = { onToggle: (id: string, c: boolean) => toggle.mutate({ id, checked: c }), onRemove: removeItem };

  return (
    <section className="page">
      <header className="page-header">
        <h1>Shopping list</h1>
        <p className="muted">Shared with everyone. Checked-off items clear after {data?.retentionHours ?? 12} hours.</p>
      </header>

      <AddForm placeholder="Add an item…" parentId={null} />

      {error && <p className="form-error">{error.message}</p>}
      {toggle.error && <p className="form-error">{toggle.error.message}</p>}
      {isPending && <p className="muted center">Loading…</p>}
      {data && open.length === 0 && <p className="empty">{checked.length ? 'All done.' : 'The list is empty.'}</p>}

      {open.length > 0 && (
        <ul className="task-list shop-list">
          {open.map((item) => {
            const subs = children(item.id).filter((s) => !s.checkedAt);
            return (
              <li key={item.id} className="shop-group">
                <ShopRow item={item} {...rowProps} onAddSub={() => setAddingTo(addingTo === item.id ? null : item.id)} />
                {(subs.length > 0 || addingTo === item.id) && (
                  <ul className="shop-subs">
                    {subs.map((s) => (
                      <li key={s.id}>
                        <ShopRow item={s} {...rowProps} />
                      </li>
                    ))}
                    {addingTo === item.id && (
                      <li className="shop-subs__add">
                        <AddForm placeholder={`Add to ${item.title}…`} parentId={item.id} autoFocus onDone={() => setAddingTo(null)} />
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {checked.length > 0 && (
        <>
          <h2 className="section-title">Checked off · {checked.length}</h2>
          <ul className="task-list shop-list">
            {checked.map((item) => {
              const parent = item.parentId ? items.find((p) => p.id === item.parentId) : null;
              const subs = item.parentId === null ? children(item.id) : [];
              const who = item.checkedBy === me.id ? 'You' : (byId.get(item.checkedBy ?? '')?.displayName ?? 'Someone');
              return (
                <li key={item.id} className="shop-group">
                  <ShopRow item={item} {...rowProps} context={parent?.title} meta={`${who} · ${timeAgo(item.checkedAt!)}`} />
                  {subs.length > 0 && (
                    <ul className="shop-subs">
                      {subs.map((s) => (
                        <li key={s.id}>
                          <ShopRow item={s} {...rowProps} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

interface RowProps {
  item: ShoppingItem;
  onToggle: (id: string, checked: boolean) => void;
  onRemove: (item: ShoppingItem) => void;
  onAddSub?: () => void;
  /** For a sub-item shown without its item: the item's title. */
  context?: string;
  meta?: string;
}

function ShopRow({ item, onToggle, onRemove, onAddSub, context, meta }: RowProps) {
  const done = Boolean(item.checkedAt);
  return (
    <div className={`shop-row${done ? ' is-done' : ''}`}>
      <button
        className="check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Put "${item.title}" back on the list` : `Check off "${item.title}"`}
        onClick={() => onToggle(item.id, !done)}
      >
        {done && <CheckIcon />}
      </button>
      <span className="shop-row__text">
        <span className="shop-row__title">{item.title}</span>
        {(context || meta) && (
          <span className="shop-row__meta muted">
            {context && <span>in {context}</span>}
            {meta && <span>{meta}</span>}
          </span>
        )}
      </span>
      {onAddSub && (
        <button className="icon-btn icon-btn--small" onClick={onAddSub} aria-label={`Add a sub-item to "${item.title}"`}>
          <SubItemIcon />
        </button>
      )}
      <button className="icon-btn icon-btn--small" onClick={() => onRemove(item)} aria-label={`Remove "${item.title}"`}>
        <XIcon />
      </button>
    </div>
  );
}

function AddForm({
  placeholder,
  parentId,
  autoFocus,
  onDone,
}: {
  placeholder: string;
  parentId: string | null;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const add = useMutation({
    mutationFn: (t: string) => api.shopping.add(t, parentId),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return onDone?.();
    // Clear at once so the next item can be typed while this one saves.
    setTitle('');
    add.mutate(t, { onError: () => setTitle((cur) => cur || t) });
  };
  return (
    <form className={`quick-add${parentId ? ' quick-add--sub' : ''}`} onSubmit={submit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone?.()}
        placeholder={placeholder}
        aria-label={parentId ? 'New sub-item' : 'New shopping item'}
        maxLength={200}
        enterKeyHint="done"
        autoFocus={autoFocus}
      />
      <button type="submit" className="btn btn--primary" disabled={!title.trim()} aria-label="Add">
        <PlusIcon />
      </button>
      {add.isError && <p className="form-error">{add.error.message}</p>}
    </form>
  );
}
