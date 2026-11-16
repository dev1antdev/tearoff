import { memo, type ChangeEvent } from 'react';
import type {
  CarChoice,
  CarChoiceGroup,
} from '@irdashies/domain/raceHistory/carChoice';

interface CarChoiceSelectProps {
  /** Every car on offer, in the order they are listed. */
  choices: readonly CarChoice[];
  /** The car shown. */
  value: number;
  onChange: (carIdx: number) => void;
}

const GROUPS: readonly CarChoiceGroup[] = ['own', 'class', 'rest'];

/** "#77 Tearoff Endurance"; a car of another class says which it is. */
const optionText = (choice: CarChoice, withClass: boolean): string =>
  [`#${choice.number}`, withClass && choice.className, choice.name]
    .filter(Boolean)
    .join(' ');

/**
 * Which car a panel is about: our own first, then the cars of our class by
 * place, then everybody else. One small box for the header of a panel, and
 * the browser's own list when opened, which a finger works as well as a
 * mouse on the Pit Wall of a tablet.
 */
export const CarChoiceSelect = memo(
  ({ choices, value, onChange }: CarChoiceSelectProps) => {
    const own = choices.find((choice) => choice.group === 'own');
    const isOwn = own?.carIdx === value;
    const classOfOwn = own?.className || 'Our class';
    const groupLabel: Record<CarChoiceGroup, string> = {
      own: 'Our car',
      class: classOfOwn,
      // With no car of our own, the whole field is one list.
      rest: own ? 'Other classes' : 'Cars',
    };

    return (
      <select
        aria-label="Car"
        data-testid="car-choice"
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange(Number(event.target.value))
        }
        className={`max-w-[16rem] min-w-0 cursor-pointer truncate rounded-sm border border-slate-600 bg-slate-900 py-0.5 pr-1 pl-1.5 text-[12px] leading-5 font-semibold ${
          isOwn ? 'text-amber-300' : 'text-white'
        }`}
      >
        {GROUPS.map((group) => {
          const cars = choices.filter((choice) => choice.group === group);
          if (cars.length === 0) return null;
          return (
            <optgroup
              key={group}
              label={groupLabel[group]}
              className="font-normal text-slate-400"
            >
              {cars.map((choice) => (
                <option
                  key={choice.carIdx}
                  value={choice.carIdx}
                  className="text-white"
                >
                  {optionText(choice, group === 'rest')}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    );
  }
);
CarChoiceSelect.displayName = 'CarChoiceSelect';
