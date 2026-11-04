import type { Person } from '../types';

interface Props {
  /** People to choose from (everyone except the current user). */
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** Toggle chips for choosing who else a task is shared with. */
export function SharePicker({ people, selected, onChange }: Props) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div className="share-picker" role="group" aria-label="Share with">
      {people.map((u) => {
        const on = selected.includes(u.id);
        return (
          <button
            key={u.id}
            type="button"
            className={`person-chip${on ? ' is-on' : ''}`}
            aria-pressed={on}
            onClick={() => toggle(u.id)}
          >
            <span className="avatar" aria-hidden>
              {initials(u.displayName)}
            </span>
            {u.displayName}
          </button>
        );
      })}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}
