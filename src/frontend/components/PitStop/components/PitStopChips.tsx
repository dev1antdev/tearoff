import { memo } from 'react';
import {
  DiscIcon,
  FanIcon,
  GasPumpIcon,
  LightningIcon,
  TireIcon,
  UsersIcon,
  WarningIcon,
  WrenchIcon,
  type Icon,
} from '@phosphor-icons/react';
import {
  formatPitSeconds,
  type PitStopChipKind,
} from '@irdashies/domain/pitStop';

const ICONS: Record<PitStopChipKind, Icon> = {
  fuel: GasPumpIcon,
  energy: LightningIcon,
  tyres: TireIcon,
  repair: WrenchIcon,
  optionalRepair: WrenchIcon,
  driver: UsersIcon,
  brakes: DiscIcon,
  brakeDucts: FanIcon,
  penalty: WarningIcon,
  driveThrough: WarningIcon,
};

/** What a screen reader, and a hover, is told the chip stands for. */
const NAMES: Record<PitStopChipKind, string> = {
  fuel: 'Fuel',
  energy: 'Virtual energy',
  tyres: 'Tyres',
  repair: 'Repair',
  optionalRepair: 'Optional repair',
  driver: 'Driver change',
  brakes: 'Brakes',
  brakeDucts: 'Brake ducts',
  penalty: 'Penalty',
  driveThrough: 'Drive-through',
};

const TONES = {
  main: 'bg-sky-700',
  part: 'bg-slate-600/60',
  penalty: 'bg-red-700',
} as const;

interface PitStopChipProps {
  kind: PitStopChipKind;
  /** Seconds; null for a drive-through. */
  seconds: number | null;
  tone: keyof typeof TONES;
}

/**
 * One part of the stop: what it is, as an icon, and the seconds the sim
 * gives it. The longest of the work is the blue one; a penalty is red.
 */
export const PitStopChip = memo(({ kind, seconds, tone }: PitStopChipProps) => {
  const ChipIcon = ICONS[kind];
  return (
    <span
      data-testid={`pit-stop-chip-${kind}`}
      data-tone={tone}
      title={NAMES[kind]}
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs font-bold leading-none ${TONES[tone]}`}
    >
      <ChipIcon size="1.1em" weight="fill" aria-label={NAMES[kind]} />
      {kind === 'driveThrough' ? (
        <span>DT</span>
      ) : (
        <span>
          {kind === 'optionalRepair' && (
            <span className="font-semibold text-white/70">opt </span>
          )}
          {formatPitSeconds(seconds)}
        </span>
      )}
    </span>
  );
});
PitStopChip.displayName = 'PitStopChip';
