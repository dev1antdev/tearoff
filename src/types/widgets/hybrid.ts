import { defineWidgetManifest } from './types';
import { numberOptions } from './properties';

export default defineWidgetManifest({
  id: 'hybrid',
  name: 'Hybrid',
  category: 'Car & Controls',
  enabled: false,
  layout: {
    x: 6,
    y: 700,
    // The charge with its bar over one row of cells. The motor row, off by
    // default, wants about 36 px more.
    width: 260,
    height: 96,
  },
  config: {
    background: { opacity: 80 },
    lowChargePct: 10,
    highChargePct: 95,
    warningFlash: true,
    decimals: 1,
    showLapUse: true,
    freezeSeconds: 10,
    showNetEstimate: true,
    showDeployTimer: true,
    showMotor: false,
    motor: {
      showTemps: true,
      showRpm: true,
      showTorque: true,
      showPower: true,
      showRegen: true,
    },
    motorTempWarnC: 80,
    coolantTempWarnC: 80,
    temperatureUnit: 'celsius',
    powerUnit: 'kW',
    showOnlyWhenOnTrack: true,
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
      description: 'Opacity of the widget background.',
      min: 0,
      max: 100,
      step: 5,
      units: '%',
    },
    decimals: {
      type: 'enum',
      label: 'Decimals',
      description: 'Of the charge and of the figures for the lap.',
      options: numberOptions(0, 2),
    },
    lowChargePct: {
      type: 'number',
      label: 'Low Charge',
      description: 'At or below this the charge is drawn red.',
      min: 0,
      max: 50,
      step: 1,
      units: '%',
    },
    highChargePct: {
      type: 'number',
      label: 'Full Charge',
      description:
        'At or above this the charge is drawn amber: a full battery has nowhere to put what the next braking zone recovers.',
      min: 50,
      max: 100,
      step: 1,
      units: '%',
    },
    warningFlash: {
      type: 'boolean',
      label: 'Flash On A Warning',
      description:
        'Pulses the charge ten times as it becomes low or full, then holds the colour.',
    },
    showLapUse: {
      type: 'boolean',
      label: 'Used And Regen',
      description: 'Charge used and recovered so far on this lap.',
    },
    freezeSeconds: {
      type: 'number',
      label: 'Hold Last Lap For',
      description:
        "After the line, Used and Regen show the last lap's totals for this long, marked LAST, before starting again.",
      min: 0,
      max: 30,
      step: 1,
      units: 's',
    },
    showNetEstimate: {
      type: 'boolean',
      label: 'Net',
      description:
        'What this lap is on course to add to or take from the battery, measured against the last clean lap. Blank until one has been driven from the line.',
    },
    showDeployTimer: {
      type: 'boolean',
      label: 'Deploy Time',
      description: 'Seconds the motor has spent deploying on this lap.',
    },
    showMotor: {
      type: 'boolean',
      label: 'Show Motor Row',
      description:
        'Temperatures, speed, torque and power of the motor. Their units are not confirmed yet; the widget wants about 36 px more height with this on.',
    },
    'motor.showTemps': {
      type: 'boolean',
      label: 'Motor And Coolant Temperature',
    },
    'motor.showRpm': { type: 'boolean', label: 'Motor Speed' },
    'motor.showTorque': { type: 'boolean', label: 'Motor Torque' },
    'motor.showPower': {
      type: 'boolean',
      label: 'Motor Power',
      description: 'Torque times speed; zero while the motor is not driving.',
    },
    'motor.showRegen': {
      type: 'boolean',
      label: 'Regeneration',
      description:
        "The sim's own regeneration reading, taken to be a power. What it measures is not confirmed.",
    },
    motorTempWarnC: {
      type: 'number',
      label: 'Motor Overheat',
      description: 'Red from here, amber from ten degrees below.',
      min: 40,
      max: 150,
      step: 1,
      units: '°C',
    },
    coolantTempWarnC: {
      type: 'number',
      label: 'Coolant Overheat',
      min: 40,
      max: 150,
      step: 1,
      units: '°C',
    },
    temperatureUnit: {
      type: 'enum',
      label: 'Temperature Unit',
      options: [
        { value: 'celsius', label: '°C' },
        { value: 'fahrenheit', label: '°F' },
      ],
    },
    powerUnit: {
      type: 'enum',
      label: 'Power Unit',
      options: [
        { value: 'kW', label: 'kW' },
        { value: 'hp', label: 'hp' },
        { value: 'ps', label: 'PS' },
      ],
    },
    showOnlyWhenOnTrack: {
      type: 'boolean',
      label: 'Show only when on track',
      description: 'If enabled, widget will only be shown when driving.',
    },
  },
});
