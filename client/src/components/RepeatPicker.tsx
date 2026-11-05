import { describeRepeat, isoWeekday, KIND_HELP, KIND_LABEL, weekdayShort } from '../repeat';
import { FREQUENCIES, KINDS, type Frequency, type TaskRepeat } from '../types';

interface Props {
  value: TaskRepeat | null;
  onChange: (value: TaskRepeat | null) => void;
  /** The task's day: the schedule is anchored on it. */
  anchor: string;
}

const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const UNIT: Record<Frequency, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

export function RepeatPicker({ value, onChange, anchor }: Props) {
  const setFrequency = (frequency: Frequency | 'none') => {
    if (frequency === 'none') return onChange(null);
    onChange({
      frequency,
      every: value?.every ?? 1,
      weekdays: frequency === 'weekly' ? [isoWeekday(anchor)] : [],
      kind: value?.kind ?? 'fixed',
    });
  };

  const toggleWeekday = (day: number) => {
    if (!value) return;
    // A flexible series shifts with every completion, so it can only follow one weekday.
    if (value.kind === 'variable') return onChange({ ...value, weekdays: [day] });
    const has = value.weekdays.includes(day);
    const weekdays = has ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day];
    if (weekdays.length) onChange({ ...value, weekdays });
  };

  return (
    <fieldset className="field repeat">
      <legend>Repeat</legend>
      <div className="repeat__row">
        <select
          value={value?.frequency ?? 'none'}
          onChange={(e) => setFrequency(e.target.value as Frequency | 'none')}
          aria-label="How often"
        >
          <option value="none">Doesn't repeat</option>
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {FREQUENCY_LABEL[f]}
            </option>
          ))}
        </select>
        {value && (
          <label className="repeat__every">
            every
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={value.every}
              onChange={(e) => onChange({ ...value, every: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })}
              aria-label="Every how many"
            />
            {UNIT[value.frequency][value.every === 1 ? 0 : 1]}
          </label>
        )}
      </div>

      {value?.frequency === 'weekly' && (
        <div className="weekdays" role="group" aria-label="On these days">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
            const on = value.weekdays.includes(d);
            return (
              <button
                key={d}
                type="button"
                className={`weekday${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleWeekday(d)}
              >
                {weekdayShort(d).slice(0, 2)}
              </button>
            );
          })}
        </div>
      )}

      {value && (
        <>
          <div className="kinds" role="radiogroup" aria-label="If it isn't done">
            {KINDS.map((k) => (
              <label key={k} className={`kind${value.kind === k ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="repeat-kind"
                  checked={value.kind === k}
                  onChange={() =>
                    onChange({
                      ...value,
                      kind: k,
                      weekdays: k === 'variable' ? value.weekdays.slice(0, 1) : value.weekdays,
                    })
                  }
                />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
          <p className="muted repeat__summary">
            <strong>{describeRepeat(value, anchor)}.</strong> {KIND_HELP[value.kind]}
          </p>
        </>
      )}
    </fieldset>
  );
}
