import { useId, useState } from 'react';

interface RpmFieldProps {
  ariaLabel: string;
  value: number;
  min?: number;
  max?: number;
  isValid: (rpm: number) => boolean;
  /** Shown while what is typed cannot be saved. */
  error: string;
  onCommit: (rpm: number) => void;
}

/**
 * An RPM input that saves when it loses focus. What cannot be used is not
 * saved, and the field goes back to its value.
 */
export const RpmField = ({
  ariaLabel,
  value,
  min,
  max,
  isValid,
  error,
  onCommit,
}: RpmFieldProps) => {
  const errorId = useId();
  const [draft, setDraft] = useState<string>();
  const typed = draft === undefined ? value : parseInt(draft, 10);
  const invalid = draft !== undefined && !isValid(typed);

  return (
    <div className="flex-1 space-y-1">
      <input
        aria-label={ariaLabel}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        type="number"
        value={draft ?? value}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === undefined) return;
          if (isValid(typed)) onCommit(typed);
          setDraft(undefined);
        }}
        className="settings-field w-full tabular-nums"
      />
      {invalid && (
        <p id={errorId} role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
};
