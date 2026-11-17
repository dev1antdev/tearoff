import { defineWidgetManifest } from './types';
import { numberOptions } from './properties';

export default defineWidgetManifest({
  id: 'finishorder',
  name: 'Finish Projection',
  category: 'Standings',
  enabled: false,
  layout: {
    x: 940,
    y: 300,
    // A header, a table of five rows with a column for each stop length,
    // and four class rivals under it.
    width: 440,
    height: 230,
  },
  config: {
    background: { opacity: 80 },
    scenarios: [30, 40, 50, 60],
    leaderStops: 'same',
    showPlanned: true,
    showToFinish: true,
    showLast: true,
    extraTime: 2,
    nearRange: 20,
    extraLaps: 1,
    showExtraRefuel: true,
    refuelDisplay: 'toAdd',
    fuelUnits: 'L',
    showLapFractions: false,
    showRivals: true,
    rivalsAhead: 2,
    rivalsBehind: 2,
    includePace: false,
    showOnlyWhenOnTrack: false,
    sessionVisibility: {
      race: true,
      loneQualify: false,
      openQualify: false,
      practice: false,
      offlineTesting: false,
    },
  },
  properties: {
    'background.opacity': {
      type: 'number',
      label: 'Background Opacity',
      description: 'Opacity of the widget background.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    leaderStops: {
      type: 'enum',
      label: 'Leader In A Stop Column',
      description:
        'Whether the leader loses the same time as you in a stop-length column. Same Stop compares like with like when the leader still has to stop; No Stop is for a leader that will not.',
      options: [
        { value: 'same', label: 'Same Stop' },
        { value: 'none', label: 'No Stop' },
      ],
    },
    showPlanned: {
      type: 'boolean',
      label: 'Planned Stop',
      description:
        'A column for the stop the pit menu is set to: the pit lane, the standing time the sim estimates and the extra time. It needs the pit lane of the track to be known.',
    },
    showToFinish: {
      type: 'boolean',
      label: 'Stop To Finish',
      description:
        'A column for the stop that adds exactly what its own laps to go need. Le Mans Ultimate only: it is costed with the refuelling rates the sim states, which iRacing does not give.',
    },
    showLast: {
      type: 'boolean',
      label: 'Last Stop',
      description:
        'A column for what your last stop and the leader’s last stop cost, once either has made one and is out of the pit lane again. A drive-through is not a stop: after one the car’s last stop is no longer known, and it is left out.',
    },
    extraTime: {
      type: 'number',
      label: 'Extra Time',
      description:
        'Added to every stop that is worked out, for your reaction and the crew: the planned stop, the stop to finish and each stop you still owe against a rival. Our Car and Class Rivals cost a stop without it, so a gap there is the After column with this at 0.',
      min: 0,
      max: 10,
      step: 0.5,
      units: 's',
    },
    nearRange: {
      type: 'number',
      label: 'Near A Line',
      description:
        'A finish that comes within this many seconds of the line is drawn in amber with an arrow: a few seconds either way change the lap count. Never more than a third of a lap.',
      min: 0,
      max: 60,
      step: 1,
      units: 's',
    },
    showExtraRefuel: {
      type: 'boolean',
      label: 'Extra Laps Row',
      description:
        'A second refuel row for more laps than projected: what to take when the lap count hangs on a few seconds.',
    },
    extraLaps: {
      type: 'enum',
      label: 'Extra Laps',
      description: 'Laps added in the second refuel row.',
      options: numberOptions(1, 5),
    },
    refuelDisplay: {
      type: 'enum',
      label: 'Refuel Shows',
      description:
        'To Add is what is missing for the laps to go, and 0 once what is aboard covers them. Total is the whole amount those laps need.',
      options: [
        { value: 'toAdd', label: 'To Add' },
        { value: 'total', label: 'Total' },
      ],
    },
    fuelUnits: {
      type: 'enum',
      label: 'Fuel Units',
      description: 'Virtual energy is always counted in percent.',
      options: [
        { value: 'L', label: 'Litres' },
        { value: 'gal', label: 'Gallons' },
      ],
    },
    showLapFractions: {
      type: 'boolean',
      label: 'Lap Fractions',
      description:
        'Two more rows with where the leader and you are on the lap as the clock runs out, the figures TinyPedal shows. Timed races only.',
    },
    showRivals: {
      type: 'boolean',
      label: 'Class Rivals',
      description:
        'The class cars around you with the gap now, the stops each of you still owes, and the gap once they are made.',
    },
    rivalsAhead: {
      type: 'enum',
      label: 'Rivals Ahead',
      description: 'Rows for the class cars ahead of you.',
      options: numberOptions(0, 3),
    },
    rivalsBehind: {
      type: 'enum',
      label: 'Rivals Behind',
      description: 'Rows for the class cars behind you.',
      options: numberOptions(0, 3),
    },
    includePace: {
      type: 'boolean',
      label: 'Include Pace',
      description:
        'Add to the projected gap what the difference between the two cars’ measured lap times does over the laps left.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show Only When On Track',
      description:
        'Hide the widget while the car is in its garage. It stays while a team-mate drives the car.',
    },
  },
});
