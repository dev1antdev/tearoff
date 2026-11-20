import {
  lapAveragesOverProperty,
  stintPaceAgainstProperty,
} from './properties';
import { TYRE_CHANGE_SECONDS_MAX } from '../channels/classTyres';
import { defineWidgetManifest } from './types';

/** What both switches of the tower's header say of the setting they start from. */
const HEADER_SWITCH_NOTE =
  " The switch in the tower's header starts from this and changes it for as long as the tower stays on screen.";

export default defineWidgetManifest({
  id: 'timingtower',
  name: 'Timing Tower',
  category: 'Standings',
  enabled: false,
  layout: {
    x: 40,
    y: 60,
    // Every column at once, and about twenty cars without scrolling.
    width: 960,
    height: 780,
  },
  config: {
    background: { opacity: 85 },
    averagesOver: 'clean',
    paceAgainst: 'stint',
    position: { enabled: true },
    carNumber: { enabled: true },
    // An initial and the surname: a table of fifteen columns has no room
    // for forenames.
    driver: {
      enabled: true,
      nameFormat: 'n.-surname',
      team: true,
      status: true,
    },
    gap: { enabled: true },
    interval: { enabled: true },
    lastTime: { enabled: true },
    bestTime: { enabled: true },
    avgLast5: { enabled: true },
    avgLast10: { enabled: true },
    stintPace: { enabled: true },
    sectors: { enabled: true },
    pitStops: { enabled: true },
    stintLaps: { enabled: true },
    energy: { enabled: true },
    // What four tyres take is left to the sim.
    tyres: { enabled: true, set: true, changeSeconds: 0 },
    showOnlyWhenOnTrack: false,
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
  },
  properties: {
    'background.opacity': {
      type: 'number',
      label: 'Background Opacity',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    averagesOver: {
      ...lapAveragesOverProperty,
      description: lapAveragesOverProperty.description + HEADER_SWITCH_NOTE,
    },
    paceAgainst: {
      ...stintPaceAgainstProperty,
      description: stintPaceAgainstProperty.description + HEADER_SWITCH_NOTE,
    },
    'position.enabled': {
      type: 'boolean',
      label: 'Position (P)',
      description:
        'The place in class. On the All tab, the place in the whole field.',
    },
    'carNumber.enabled': {
      type: 'boolean',
      label: 'Car Number (#)',
      description: 'Grey, after a bar in the colour of the car’s class.',
    },
    'driver.enabled': {
      type: 'boolean',
      label: 'Driver',
      description: 'Who is at the wheel, as the session names them.',
    },
    'driver.nameFormat': {
      type: 'enum',
      control: 'select',
      label: 'Name Format',
      options: [
        { value: 'name-middlename-surname', label: 'Max Emilian Verstappen' },
        { value: 'name-m.-surname', label: 'Max E. Verstappen' },
        { value: 'name-surname', label: 'Max Verstappen' },
        { value: 'n.-surname', label: 'M. Verstappen' },
        { value: 'surname-n.', label: 'Verstappen M.' },
        { value: 'surname', label: 'Verstappen' },
      ],
    },
    'driver.team': {
      type: 'boolean',
      label: 'Team Under The Name',
      description:
        'The team in smaller type under the driver. Off, a row is one line high and more cars fit.',
    },
    'driver.status': {
      type: 'boolean',
      label: 'Status Tag',
      description:
        'After the name: PIT in the pit lane, OUT on the lap a car leaves it on, GAR in its garage, AWAY when it is not in the world, and DNF or DQ.',
    },
    'gap.enabled': {
      type: 'boolean',
      label: 'Gap',
      description:
        'To the leader of the class; on the All tab, to the leader of the race. In laps once a car is more than a lap behind. Outside a race, the difference between best laps.',
    },
    'interval.enabled': {
      type: 'boolean',
      label: 'Interval (Int)',
      description: 'To the car one row up.',
    },
    'lastTime.enabled': {
      type: 'boolean',
      label: 'Last Lap',
      description:
        'Purple when it is the best lap of the class, green when it is the car’s own best. A lap Le Mans Ultimate gave no time is dimmed and marked.',
    },
    'bestTime.enabled': {
      type: 'boolean',
      label: 'Best Lap',
      description: 'Purple for the best lap of the class.',
    },
    'avgLast5.enabled': {
      type: 'boolean',
      label: 'Avg 5',
      description:
        'The average of the car’s last 5 laps. Reads -- until it has 5.',
    },
    'avgLast10.enabled': {
      type: 'boolean',
      label: 'Avg 10',
      description:
        'The average of the car’s last 10 laps. Reads -- until it has 10.',
    },
    'stintPace.enabled': {
      type: 'boolean',
      label: 'vs Stint',
      description:
        'This stint’s average clean lap against an earlier stint of the same car: green and negative when quicker. Reads -- until the stint has three clean laps and there is an earlier stint to compare with. While it is shown, Tearoff records the race.',
    },
    'sectors.enabled': {
      type: 'boolean',
      label: 'Sectors (Sect)',
      description:
        'Three squares for the car’s most recent first, second and third sector: purple for the best of the class, green for the car’s own best, amber for slower than that, grey with no time yet. The bests are of the sectors driven since the tower was first shown in the session. Le Mans Ultimate only: iRacing times nobody else’s sectors, and the column is left out there.',
    },
    'pitStops.enabled': {
      type: 'boolean',
      label: 'Stops',
      description:
        'Pit stops made. Le Mans Ultimate counts them itself; under iRacing they are the stops seen since the tower was first shown.',
    },
    'stintLaps.enabled': {
      type: 'boolean',
      label: 'Stint',
      description:
        'Laps completed since the car last stopped, or since the start. Reads -- where the stop was not seen.',
    },
    'energy.enabled': {
      type: 'boolean',
      label: 'Energy',
      description:
        'Virtual energy left, percent, for a car that runs on it; fuel left, marked with a pump, for one that does not. Le Mans Ultimate only: the column is left out where no car publishes either.',
    },
    'tyres.enabled': {
      type: 'boolean',
      label: 'Tyres',
      description: 'The compound on the car; four marks where they differ.',
    },
    'tyres.set': {
      type: 'boolean',
      label: 'Laps On The Set And Tread',
      description:
        'For the cars of your own class, beside the compound: the laps the car has run on its tyres, and the tread left. No sim says that a rival changed tyres, so the laps come with how sure they are. Bare: another compound was seen on the car after a stop, or it has not stopped. With ?: told from how long it stood at a stop, against what its refill and driver change explain. With +: at least that many, counted from a stop, a spell in the garage or laps Tearoff did not see, at which any set may have gone on. The tread is an estimate marked ~: what a lap costs your own car on that compound, times those laps. It is your wear applied to their laps, and another car wears its tyres differently. It reads -- until your own car has three clean laps on the compound, in this session or earlier ones on this track, and < in place of ~ where the laps are only a floor. Your own car shows its real tread, as does every car where the sim publishes it (Le Mans Ultimate offline). Under iRacing only the laps are shown. While it is shown, Tearoff records the race.',
    },
    'tyres.changeSeconds': {
      type: 'number',
      control: 'input',
      label: 'Tyre Change Takes',
      description:
        'How long a change of four tyres keeps a car standing, for telling one from the length of a stop. At 0 Tearoff takes what Le Mans Ultimate states for your own car, which is a guess for the rest of the class; iRacing states none, and a stop is then not judged by its length at all. A stop that long beyond its refill counts as a likely change, one shorter than this as none. Class Rivals reads the same figure.',
      min: 0,
      max: TYRE_CHANGE_SECONDS_MAX,
      step: 1,
      units: 's',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive and while you watch a car on track. The Pit Wall shows the tower whatever this says.',
    },
  },
});
