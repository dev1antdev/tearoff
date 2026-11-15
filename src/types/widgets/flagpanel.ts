import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'flagpanel',
  name: 'Flag Panel',
  category: 'Spotter & Safety',
  enabled: false,
  layout: {
    x: 300,
    y: 50,
    // A wide card: the colour block, two lines of text and a figure.
    width: 440,
    height: 92,
  },
  config: {
    background: { opacity: 80 },
    showExplanation: true,
    blueName: 'driver',
    driverNameFormat: 'name-middlename-surname',
    bluePair: 'dashes',
    distanceUnit: 'auto',
    tintCard: 'active',
    blue: { raceOnly: false },
    yellow: {
      raceOnly: false,
      rangeAhead: 500,
      rangeBehind: 50,
      nameSector: false,
    },
    showStartLights: true,
    showPenalty: true,
    showLastLap: true,
    whenClear: 'green',
    enableGlow: true,
    animate: true,
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
      description: 'Opacity of the card. A tinted card follows it.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    showExplanation: {
      type: 'boolean',
      label: 'Show Explanation',
      description:
        'The line under the flag name. Under a blue flag that line names the car to let by and is always shown.',
    },
    tintCard: {
      type: 'enum',
      label: 'Tint The Card',
      description:
        'Off keeps the card dark and colours only the block. Active tints it for the flags that need attention. Always also tints a clear track green.',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'active', label: 'Active' },
        { value: 'always', label: 'Always' },
      ],
    },
    whenClear: {
      type: 'enum',
      label: 'When The Track Is Clear',
      description: 'Show GREEN FLAG, or hide the card until a flag is out.',
      options: [
        { value: 'green', label: 'Green Flag' },
        { value: 'hide', label: 'Hide' },
      ],
    },
    enableGlow: {
      type: 'boolean',
      label: 'Enable Glow Effect',
      description: 'A glow around the colour block and inside a tinted card.',
    },
    animate: {
      type: 'boolean',
      label: 'Animate',
      description:
        'Pulse the colour block for a yellow flag close by and for a blue flag.',
    },
    blueName: {
      type: 'enum',
      label: 'Name Under Blue Flag',
      description:
        'The driver at the wheel, or the team in team events. An entry with no team name shows the driver.',
      options: [
        { value: 'driver', label: 'Driver' },
        { value: 'team', label: 'Team' },
      ],
    },
    driverNameFormat: {
      type: 'enum',
      label: 'Driver Name Format',
      control: 'select',
      options: [
        { value: 'name-middlename-surname', label: 'John Michael Smith' },
        { value: 'name-m.-surname', label: 'John M. Smith' },
        { value: 'name-surname', label: 'John Smith' },
        { value: 'n.-surname', label: 'J. Smith' },
        { value: 'surname-n.', label: 'Smith J.' },
        { value: 'surname', label: 'Smith' },
      ],
    },
    bluePair: {
      type: 'enum',
      label: 'Class And Distance Without A Blue',
      description:
        'What the right-hand side shows while no blue flag is out: dashes, or nothing.',
      options: [
        { value: 'dashes', label: 'Dashes' },
        { value: 'hidden', label: 'Hidden' },
      ],
    },
    distanceUnit: {
      type: 'enum',
      label: 'Distance Unit',
      description: 'Auto follows the units set in the sim.',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'm', label: 'Metres' },
        { value: 'ft', label: 'Feet' },
      ],
    },
    'blue.raceOnly': {
      type: 'boolean',
      label: 'Blue Flag In Races Only',
      description: 'Leave the blue flag out in practice and qualifying.',
    },
    'yellow.raceOnly': {
      type: 'boolean',
      label: 'Yellow Flag In Races Only',
      description:
        'Leave local yellows out in practice and qualifying. A full course yellow is always shown.',
    },
    'yellow.rangeAhead': {
      type: 'number',
      label: 'Incident Range Ahead',
      description:
        'A stopped car this close ahead makes the yellow yours: it is shown over a blue flag with the distance to it.',
      min: 100,
      max: 1000,
      step: 50,
      units: 'm',
    },
    'yellow.rangeBehind': {
      type: 'number',
      label: 'Incident Range Behind',
      description: 'The same for a stopped car you have just passed.',
      min: 0,
      max: 200,
      step: 10,
      units: 'm',
    },
    'yellow.nameSector': {
      type: 'boolean',
      label: 'Name The Sector',
      description:
        'Treat a yellow in your own sector as yours and name the sector. Le Mans Ultimate only, and experimental: the order of its sector flags is not confirmed.',
    },
    showStartLights: {
      type: 'boolean',
      label: 'Show Start States',
      description:
        'The grid, the formation lap and the start lights before a race.',
    },
    showPenalty: {
      type: 'boolean',
      label: 'Show Penalties',
      description: 'A drive-through, stop-go or time penalty still to serve.',
    },
    showLastLap: {
      type: 'boolean',
      label: 'Show Last Lap',
      description: 'The final lap of a race.',
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, the panel will only be shown when driving.',
    },
  },
});
