import { numberOptions } from './properties';
import { defineWidgetManifest } from './types';

export default defineWidgetManifest({
  id: 'laptimelog',
  name: 'Lap Timer',
  category: 'Lap Timing',
  enabled: false,
  layout: {
    x: 300,
    y: 100,
    width: 250,
    height: 250,
  },
  config: {
    scale: 100,
    alignment: 'top',
    reverse: false,
    showCurrentLap: true,
    showPredictedLap: true,
    showLastLap: true,
    showBestLap: true,
    showAllTimeLap: false,
    delta: {
      enabled: true,
      method: 'bestlap',
    },
    history: {
      enabled: true,
      count: 10,
      style: 'list',
      hidePittedLaps: false,
      hideCautionLaps: false,
      // The cells below are off so that a saved dashboard keeps its look and
      // the default width still fits; with all of them on the list wants
      // about 320 px.
      showStintLap: false,
      showFuel: false,
      showWear: false,
      wearMode: 'average',
      showFlags: true,
      showCurrentRow: false,
      thisStintOnly: false,
    },
    fuelUnits: 'L',
    background: {
      opacity: 80,
    },
    foreground: {
      opacity: 70,
    },
    sessionVisibility: {
      race: true,
      loneQualify: true,
      openQualify: true,
      practice: true,
      offlineTesting: true,
    },
    showOnlyWhenOnTrack: true,
  },
  properties: {
    showCurrentLap: {
      type: 'boolean',
      label: 'Show Current Lap',
      description: 'Display the live lap time for the current lap.',
    },
    showPredictedLap: {
      type: 'boolean',
      label: 'Show Predicted Lap',
      description:
        'Show the current predicted lap based on the current delta time.',
    },
    showLastLap: {
      type: 'boolean',
      label: 'Show Last Lap',
      description: "Show the driver's last lap time.",
    },
    showBestLap: {
      type: 'boolean',
      label: 'Show Session Best Lap',
      description: "Show the driver's best lap time this session.",
    },
    showAllTimeLap: {
      type: 'boolean',
      label: 'Show Personal Best Lap',
      description:
        'Shows the best lap time ever recorded by Tearoff for the car and track combo.',
    },
    'delta.enabled': {
      type: 'boolean',
      label: 'Display Lap Delta',
      description:
        "Choose which lap to base the delta calculation on. This can be the driver's last lap, best lap, or the overall session best lap.",
    },
    'delta.method': {
      type: 'enum',
      label: 'Delta Calculation Base Lap',
      options: [
        { value: 'lastlap', label: 'Last Lap' },
        { value: 'bestlap', label: 'Best Lap' },
      ],
    },
    'history.enabled': {
      type: 'boolean',
      label: 'Show Lap History',
      description:
        "Show the driver's lap history. You can configure how many to show below.",
    },
    'history.style': {
      type: 'enum',
      label: 'History Style',
      options: [
        { value: 'list', label: 'List' },
        { value: 'chart', label: 'Graph' },
      ],
    },
    'history.count': {
      type: 'enum',
      label: 'Number Of Laps To Show',
      options: numberOptions(1, 20),
      control: 'select',
    },
    'history.hidePittedLaps': {
      type: 'boolean',
      label: 'Hide Pitted Laps',
      description:
        'Leave out laps where you pitted. They are much slower than a green lap, so they stretch the chart and pull the average away from your real pace.',
    },
    'history.hideCautionLaps': {
      type: 'boolean',
      label: 'Hide Caution Laps',
      description:
        'Leave out laps driven under full-course cautions, keeping the graph scale and average focused on green-flag pace. Local yellows are kept.',
    },
    'history.thisStintOnly': {
      type: 'boolean',
      label: 'This Stint Only',
      description:
        'List only the laps of the stint you are driving. Back in the garage, the stint you last drove.',
    },
    'history.showCurrentRow': {
      type: 'boolean',
      label: 'Show The Lap Under Way',
      description:
        'A first row for the lap you are on: its running time and what it has used so far.',
    },
    'history.showFlags': {
      type: 'boolean',
      label: 'Show Lap Marks',
      description:
        'Marks beside the lap number: a garage for an in-lap or an out-lap, a cross for a lap the sim voided or one with an incident, a yellow flag for a yellow (with FCY for a full-course caution), a drop for a wet lap and a green flag for the first lap of a race, which is timed from the green.',
    },
    'history.showStintLap': {
      type: 'boolean',
      label: 'Show Stint Lap',
      description: "The lap's number within its stint, as S5.",
    },
    'history.showFuel': {
      type: 'boolean',
      label: 'Show Fuel Used',
      description:
        'What the lap burned. A car that runs on virtual energy shows percent of its energy; any other shows fuel.',
    },
    'history.showWear': {
      type: 'boolean',
      label: 'Show Tyre Wear',
      description:
        'Tread the lap wore, in percent, amber when well above the other laps shown. Le Mans Ultimate only: iRacing reads tread in the pits, not lap by lap.',
    },
    'history.wearMode': {
      type: 'enum',
      label: 'Tyre Wear Of',
      description: 'The average of the four tyres, or the one that wore most.',
      options: [
        { value: 'average', label: 'Average' },
        { value: 'highest', label: 'Highest' },
      ],
    },
    fuelUnits: {
      type: 'enum',
      label: 'Fuel Units',
      description: 'Virtual energy is always shown in percent.',
      options: [
        { value: 'L', label: 'Litres' },
        { value: 'gal', label: 'Gallons' },
      ],
    },
    'background.opacity': {
      type: 'number',
      label: 'Background Opacity',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    'foreground.opacity': {
      type: 'number',
      label: 'Foreground Opacity',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    scale: {
      type: 'number',
      label: 'Text Scale',
      description:
        "Adjust the size of the font by adjusting this widget's scale",
      min: 50,
      max: 150,
      step: 1,
      units: '%',
    },
    reverse: {
      type: 'boolean',
      label: 'Reverse Order',
      description: 'Display the lap time elements in reverse order',
    },
    alignment: {
      type: 'enum',
      label: 'Widget Alignment',
      options: [
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
      ],
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description:
        'Hidden in the garage and in the menus. Shown while you drive, and while you watch your own car with a team-mate driving it.',
    },
  },
});
