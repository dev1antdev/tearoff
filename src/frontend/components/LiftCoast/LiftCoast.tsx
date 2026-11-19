import { memo, useMemo } from 'react';
import {
  useChannelSelector,
  useDrivingState,
  useSessionVisibility,
} from '@irdashies/context';
import type { LiftCoastConfig } from '@irdashies/types';
import { useLiftCoastSettings } from './hooks/useLiftCoastSettings';
import {
  LIFT_COAST_DARK,
  LIFT_COAST_TONE_CLASS,
  clampLightCount,
  createLiftCoastSelector,
  lightTone,
  type LiftCoastLights,
  type LiftCoastTone,
} from './liftCoastDisplay';

/**
 * The side of one light, as large as the box allows: its short side, or an
 * equal share of its long side less the gaps, whichever is smaller. `--slots`
 * is the number of lights the long side has to hold.
 */
const LIGHT_SIZE = {
  horizontal:
    '[--light:min(100cqh,calc((100cqw_-_(var(--slots)_-_1)_*_0.25rem)_/_var(--slots)))]',
  vertical:
    '[--light:min(100cqw,calc((100cqh_-_(var(--slots)_-_1)_*_0.25rem)_/_var(--slots)))]',
};

/** Which way a strip lays out its lights, first light first. */
const STRIP_FLOW: Record<LiftCoastConfig['direction'], string> = {
  right: 'flex-row',
  left: 'flex-row-reverse',
  down: 'flex-col',
  up: 'flex-col-reverse',
};

const OPPOSITE: Record<
  LiftCoastConfig['direction'],
  LiftCoastConfig['direction']
> = {
  right: 'left',
  left: 'right',
  down: 'up',
  up: 'down',
};

interface LightProps {
  tone: LiftCoastTone;
  horizontal: boolean;
}

/** One light. Takes its colour by name, so only a light that changes redraws. */
const Light = memo(({ tone, horizontal }: LightProps) => (
  <div
    data-tone={tone}
    className={`aspect-square flex-none rounded-full ${
      horizontal ? 'w-(--light)' : 'h-(--light)'
    } ${LIFT_COAST_TONE_CLASS[tone]}`}
  />
));
Light.displayName = 'Light';

interface StripProps {
  lights: LiftCoastLights;
  count: number;
  direction: LiftCoastConfig['direction'];
  horizontal: boolean;
}

const Strip = ({ lights, count, direction, horizontal }: StripProps) => (
  <div className={`flex flex-none gap-1 ${STRIP_FLOW[direction]}`}>
    {Array.from({ length: count }, (_, index) => (
      <Light
        key={index}
        tone={lightTone(lights, index)}
        horizontal={horizontal}
      />
    ))}
  </div>
);

/**
 * A strip of lights that fills with Le Mans Ultimate's own lift-and-coast
 * signal and changes colour once it is nearly full, and that ABS and
 * traction control take over, whole, while they work.
 *
 * The signal follows the energy-saving target the driver sets in the car.
 * Without one, in a car or a session that has none, it reads 0 and the strip
 * stays dark, or is not drawn at all with "Hide while dark"; the assists
 * still light it.
 */
export const LiftCoast = () => {
  const settings = useLiftCoastSettings();
  const selector = useMemo(() => createLiftCoastSelector(settings), [settings]);
  const lights =
    useChannelSelector('driver-controls.snapshot', selector) ?? LIFT_COAST_DARK;
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);

  if (!isSessionVisible) return <></>;
  // The pedals and the aids of the user's own car: nothing to show for a
  // car that is only being watched.
  if (settings.showOnlyWhenOnTrack && !isDriving) return <></>;
  if (settings.hideWhenDark && lights.lit === 0 && lights.override === null) {
    return <></>;
  }

  const count = clampLightCount(settings.ledCount);
  const horizontal =
    settings.direction === 'right' || settings.direction === 'left';
  // Two strips leave two lights' worth of room between them, so that they
  // read as two.
  const slots = settings.mirrored ? count * 2 + 2 : count;

  return (
    <div
      className="h-full w-full overlay-panel p-2"
      style={{
        ['--bg-opacity' as string]: `${settings.background.opacity}%`,
      }}
    >
      <div
        className={`@container-[size] flex h-full w-full items-center ${
          horizontal ? 'flex-row' : 'flex-col'
        } ${settings.mirrored ? 'justify-between' : 'justify-center'} ${
          horizontal ? LIGHT_SIZE.horizontal : LIGHT_SIZE.vertical
        }`}
        style={{ ['--slots' as string]: slots }}
      >
        <Strip
          lights={lights}
          count={count}
          direction={settings.direction}
          horizontal={horizontal}
        />
        {settings.mirrored && (
          <Strip
            lights={lights}
            count={count}
            direction={OPPOSITE[settings.direction]}
            horizontal={horizontal}
          />
        )}
      </div>
    </div>
  );
};
