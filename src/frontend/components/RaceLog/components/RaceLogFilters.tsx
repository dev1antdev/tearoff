import { memo } from 'react';
import {
  ArrowLineUpIcon,
  FlagIcon,
  TimerIcon,
  UserSwitchIcon,
  WarningIcon,
  WrenchIcon,
  type Icon,
} from '@phosphor-icons/react';
import {
  RACE_LOG_KIND_GROUPS,
  RACE_LOG_SCOPES,
  type RaceLogKindGroup,
} from '@irdashies/domain/raceLog';
import type { RaceLogScope } from '@irdashies/types';

const KIND_ICONS: Record<RaceLogKindGroup, Icon> = {
  pits: WrenchIcon,
  drivers: UserSwitchIcon,
  fastestLaps: TimerIcon,
  flags: FlagIcon,
  status: WarningIcon,
};

export interface RaceLogFiltersProps {
  scope: RaceLogScope;
  /** One switch a kind of event: whether it is listed. */
  pits: boolean;
  drivers: boolean;
  fastestLaps: boolean;
  flags: boolean;
  status: boolean;
  /** Lines added above the ones on screen while the reader was further down. */
  unseen: number;
  onScope: (scope: RaceLogScope) => void;
  onKind: (kind: RaceLogKindGroup) => void;
  onToTop: () => void;
}

/**
 * The row of switches over the list: whose events, and which kinds.
 *
 * They change what the list shows for as long as it is on screen and are
 * not saved: the list opens as the widget's settings say. Each kind is an
 * icon with its name as the button's label, so the row fits the narrowest
 * panel the page has.
 */
export const RaceLogFilters = memo(
  ({
    scope,
    unseen,
    onScope,
    onKind,
    onToTop,
    ...kinds
  }: RaceLogFiltersProps) => (
    <div
      data-testid="race-log-filters"
      className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b overlay-divider px-2 py-1 text-xs"
    >
      <div
        role="group"
        aria-label="Cars listed"
        className="flex overflow-hidden rounded-md border border-slate-600"
      >
        {RACE_LOG_SCOPES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={scope === id}
            onClick={() => onScope(id)}
            className={`px-2 py-0.5 leading-snug ${
              scope === id
                ? 'bg-slate-600 font-semibold text-white'
                : 'text-slate-300 hover:bg-slate-700/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Kinds of event" className="flex gap-1">
        {RACE_LOG_KIND_GROUPS.map(({ id, label }) => {
          const KindIcon = KIND_ICONS[id];
          const on = kinds[id];
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              aria-label={label}
              title={label}
              onClick={() => onKind(id)}
              className={`rounded-md border p-1 ${
                on
                  ? 'border-slate-500 bg-slate-600 text-white'
                  : 'border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              <KindIcon size={14} weight={on ? 'fill' : 'light'} />
            </button>
          );
        })}
      </div>
      {unseen > 0 && (
        <button
          type="button"
          data-testid="race-log-unseen"
          onClick={onToTop}
          className="ml-auto flex items-center gap-1 rounded-full bg-slate-200 px-1.5 py-0.5 font-semibold leading-snug text-slate-950 hover:bg-white"
        >
          <ArrowLineUpIcon size={12} weight="bold" />
          {unseen} new
        </button>
      )}
    </div>
  )
);
RaceLogFilters.displayName = 'RaceLogFilters';
