import { memo } from 'react';
import {
  CompassIcon,
  IconContext,
  MapPinLineIcon,
  MountainsIcon,
  PathIcon,
  SteeringWheelIcon,
  type Icon,
} from '@phosphor-icons/react';
import { OVERLAY_ICONS } from '@irdashies/utils/overlayIcons';
import {
  sessionBarSelectors,
  useActiveSimulator,
  useCruiseSnapshot,
  useDrivingState,
  useSessionBarSelector,
  useSessionVisibility,
} from '@irdashies/context';
import { isMetricDistance } from '@irdashies/domain/units/distance';
import type { CruiseCellId, CruiseSnapshot } from '@irdashies/types';
import { CompassDial } from './CompassDial';
import {
  NO_READING,
  compassBearing,
  formatHeading,
  formatMetres,
  formatOdometer,
  formatTimeOnTrack,
  type Figure,
} from './cruiseFormat';
import {
  useCruiseSettings,
  type CruiseSettings,
} from './hooks/useCruiseSettings';

const NO_FIGURE: Figure = { value: NO_READING, unit: '' };

interface CruiseCellProps {
  icon: Icon;
  /** What the cell is, for a reader that cannot see the icon. */
  label: string;
  value: string;
  /** Drawn small after the value: a unit, or the bearing letters. */
  unit: string;
}

/** One reading: an icon, the figure, and its unit small beside it. */
const CruiseCell = memo(
  ({ icon: CellIcon, label, value, unit }: CruiseCellProps) => (
    <div className="flex min-w-0 items-center gap-1 px-1.5 py-1" title={label}>
      <CellIcon size={14} className="flex-none text-slate-400" />
      <span className="sr-only">{label}</span>
      <span className="truncate whitespace-nowrap text-sm font-semibold tabular-nums">
        {value}
        {unit !== '' && (
          <span className="ml-0.5 text-xs font-normal text-slate-400">
            {unit}
          </span>
        )}
      </span>
    </div>
  )
);
CruiseCell.displayName = 'CruiseCell';

const CELL_ICONS: Record<CruiseCellId, Icon> = {
  compass: CompassIcon,
  elevation: MountainsIcon,
  odometer: PathIcon,
  timeOnTrack: SteeringWheelIcon,
  lapDistance: MapPinLineIcon,
};

const CELL_LABELS: Record<CruiseCellId, string> = {
  compass: 'Compass heading',
  elevation: 'Elevation',
  odometer: 'Distance driven',
  timeOnTrack: 'Time on track',
  lapDistance: 'Distance into the lap',
};

/** What a cell prints for a snapshot: a dash for a reading there is none of. */
const figureOf = (
  cell: CruiseCellId,
  snapshot: CruiseSnapshot | undefined,
  settings: CruiseSettings,
  metric: boolean
): Figure => {
  // Out of the car there is nothing of the user's own driving to show.
  if (!snapshot?.available) return NO_FIGURE;
  switch (cell) {
    case 'compass':
      return snapshot.headingDeg === null
        ? NO_FIGURE
        : {
            value: `${formatHeading(snapshot.headingDeg)}°`,
            unit: compassBearing(snapshot.headingDeg),
          };
    case 'elevation':
      return snapshot.elevationM === null
        ? NO_FIGURE
        : formatMetres(snapshot.elevationM, metric);
    case 'lapDistance':
      return snapshot.lapDistanceM === null
        ? NO_FIGURE
        : formatMetres(snapshot.lapDistanceM, metric);
    case 'odometer': {
      const metres =
        settings.odometer.scope === 'session'
          ? snapshot.sessionMetres
          : snapshot.totalMetres;
      return metres === null ? NO_FIGURE : formatOdometer(metres, metric);
    }
    case 'timeOnTrack': {
      const seconds =
        settings.timeOnTrack.scope === 'session'
          ? snapshot.sessionSeconds
          : snapshot.totalSeconds;
      return seconds === null
        ? NO_FIGURE
        : { value: formatTimeOnTrack(seconds), unit: '' };
    }
  }
};

/**
 * The cruise block: where the car points, how high the road is, how far and
 * how long the user has driven this car on this track, and how far round the
 * lap it is, with an optional compass dial.
 *
 * The figures are of the user's own car and their own driving, so out of
 * the car, and while another car is being watched, every cell is a dash.
 * Under Le Mans Ultimate north is the track model's own +Z axis and the
 * height is the model's own, not an altitude; iRacing states no height
 * while the car is driven, so the elevation cell is not drawn there.
 */
export const Cruise = () => {
  const settings = useCruiseSettings();
  const { isDriving } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings.sessionVisibility);
  // The user's own driving: nothing to show for a car that is being watched.
  const visible =
    isSessionVisible && !(settings.showOnlyWhenOnTrack && !isDriving);

  const snapshot = useCruiseSnapshot(visible);
  const displayUnits = useSessionBarSelector(sessionBarSelectors.displayUnits, {
    enabled: visible,
  });
  const statesNoHeight = useActiveSimulator() === 'iracing';

  if (!visible) return <></>;

  const metric = isMetricDistance(settings.units, displayUnits);
  const cells = settings.cells.filter(
    (cell) =>
      settings[cell].enabled && !(cell === 'elevation' && statesNoHeight)
  );
  const own = snapshot?.available === true;

  return (
    <IconContext.Provider value={OVERLAY_ICONS}>
      <div
        className="flex h-full w-full gap-1 overlay-panel p-2 text-white"
        style={{
          ['--bg-opacity' as string]: `${settings.background.opacity}%`,
        }}
      >
        {settings.compass.dial && (
          <CompassDial
            headingDeg={own ? (snapshot?.headingDeg ?? null) : null}
            driftDeg={own ? (snapshot?.driftDeg ?? null) : null}
          />
        )}
        {cells.length > 0 && (
          <div
            className={
              settings.layout === 'row'
                ? 'flex min-w-0 flex-1 flex-row flex-wrap content-center gap-1 [&>*]:flex-1'
                : 'grid min-w-0 flex-1 auto-rows-fr grid-cols-3 gap-1'
            }
          >
            {cells.map((cell) => {
              const figure = figureOf(cell, snapshot, settings, metric);
              return (
                <CruiseCell
                  key={cell}
                  icon={CELL_ICONS[cell]}
                  label={CELL_LABELS[cell]}
                  value={figure.value}
                  unit={figure.unit}
                />
              );
            })}
          </div>
        )}
      </div>
    </IconContext.Provider>
  );
};
