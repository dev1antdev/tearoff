import { useId } from 'react';
import { PlusIcon, XIcon } from '@phosphor-icons/react';

interface SettingNumberListRowProps {
  title: string;
  description?: string;
  values: readonly number[];
  /** The limits of one value. */
  min: number;
  max: number;
  step?: number;
  /** Shown after each field, e.g. `s`. */
  units?: string;
  /** The most values the list takes. */
  maxItems: number;
  /** What an added value is, given the list as it stands. */
  nextValue: (values: readonly number[]) => number;
  onChange: (values: number[]) => void;
}

/**
 * A short list of numbers: a field for each, a button to take it out, and
 * one to add another while there is room.
 */
export function SettingNumberListRow({
  title,
  description,
  values,
  min,
  max,
  step = 1,
  units,
  maxItems,
  nextValue,
  onChange,
}: SettingNumberListRowProps) {
  const descriptionId = useId();
  const clamp = (value: number) => Math.min(Math.max(value, min), max);
  const suffix = units ? ` ${units}` : '';
  return (
    <div className="flex min-h-9 flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1 basis-40">
        <h4 className="text-md font-medium text-slate-300">{title}</h4>
        {description && (
          <p id={descriptionId} className="mt-1 text-sm text-slate-400">
            {description}
          </p>
        )}
      </div>

      <div className="flex max-w-88 flex-wrap items-center justify-end gap-2">
        {values.map((value, index) => (
          // By position: the values are edited in place and may repeat.
          <div key={index} className="flex items-center gap-1">
            <input
              type="number"
              aria-label={`${title} ${index + 1}`}
              aria-describedby={description ? descriptionId : undefined}
              className="settings-field w-20 text-right font-mono tabular-nums"
              value={value}
              step={step}
              min={min}
              max={max}
              onChange={(event) => {
                const next = parseFloat(event.target.value);
                if (Number.isNaN(next)) return;
                onChange(
                  values.map((entry, at) =>
                    at === index ? clamp(next) : entry
                  )
                );
              }}
            />
            {units && <span className="text-sm text-slate-400">{units}</span>}
            <button
              type="button"
              aria-label={`Remove ${value}${suffix}`}
              title="Remove"
              onClick={() => onChange(values.filter((_, at) => at !== index))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-settings-boundary bg-slate-800 text-slate-300 transition-colors hover:border-accent-400 hover:text-white"
            >
              <XIcon size={14} weight="bold" aria-hidden />
            </button>
          </div>
        ))}
        {values.length < maxItems && (
          <button
            type="button"
            onClick={() => onChange([...values, clamp(nextValue(values))])}
            className="flex min-h-9 items-center gap-1 rounded-md border border-settings-boundary bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-200 transition-colors hover:border-accent-400"
          >
            <PlusIcon size={14} weight="bold" aria-hidden />
            Add
          </button>
        )}
      </div>
    </div>
  );
}
