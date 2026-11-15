/**
 * LMU REST payloads for the parser specs.
 *
 * Sibling of ../rawFixture.ts. The five paths the curated tape holds
 * (`test-data/telemetry/lmu-session.lmudt`, an LMGT3 in an offline race) are
 * trimmed copies of what it recorded: keys the tasks do not read are left
 * out, a few are kept so that a parser which over-reaches is noticed, and no
 * value is altered. `tapeReplay.spec.ts` holds every one of them against the
 * recording, so a fixture cannot drift from what the sim sent.
 *
 * What the tape does not hold is made by hand and says so: the menu of a
 * fuel-limited car, and the two paths the recorder does not poll.
 */

/** GET /rest/strategy/pitstop-estimate, the recording's first answer. */
export const pitstopEstimateFixture = () => ({
  brakeDucts: 0,
  brakes: 0,
  damage: 0,
  driverSwap: 0,
  fuel: 2.420665740966797,
  penalties: 0,
  tires: 0,
  total: 2.420665740966797,
  ve: 0,
});

/**
 * The same path four minutes on, the recording's last answer.
 *
 * Both fuel and energy now go in, and the total is still the fuel part: the
 * two overlap, so the parts are not a sum.
 */
export const pitstopEstimateLateFixture = () => ({
  brakeDucts: 0,
  brakes: 0,
  damage: 0,
  driverSwap: 0,
  fuel: 4.27047061920166,
  penalties: 0,
  tires: 0,
  total: 4.27047061920166,
  ve: 2.4992382526397705,
});

/**
 * `pitStopTimes.times` of the repair screen, whole: the members the task
 * reads and the ones it leaves, which is most of what a parser reaching too
 * far would trip over.
 */
const pitStopTimes = () => ({
  times: {
    BrakeChange: 120,
    BrakeTimeConcurrent: 0,
    DriverChange: 25,
    DriverConcurrent: 1,
    DriverDamage: 0,
    DriverRandom: 2,
    FenderFlareAdjust: 0,
    FixAeroDamage: 30,
    FixAllDamage: 30,
    FixRandomDelay: 5,
    FixTimeConcurrent: 0,
    FourTireChange: 12,
    FrontWingAdjust: 40,
    FrontWingReplace: 40,
    FuelFillRate: 3.4000000953674316,
    FuelInsert: 1,
    FuelRandomDelay: 2,
    FuelRemove: 1,
    FuelTimeConcurrent: 1,
    OnTheFlyPressure: false,
    PressureChange: 5,
    RadiatorChange: 10,
    RandomBrakeDelay: 0,
    RandomTireDelay: 1,
    RearWingAdjust: 25,
    RearWingReplace: 60,
    SimultaneousStopGo: false,
    SpringRubberChange: 0,
    TireTimeConcurrent: 0,
    TrackBarChange: 0,
    TwoTireChange: 4.5,
    WedgeChange: 0,
    virtualEnergyFillRate: 0.02500000037252903,
    virtualEnergyInsert: 0,
    virtualEnergyRandomDelay: 0,
    virtualEnergyRemove: 0,
    virtualEnergyTimeConcurrent: 1,
  },
});

/**
 * The pit menu of the recorded car, which runs on virtual energy.
 *
 * Five of its eighteen entries; the wing, grille, pressure, brake duct, driver
 * and per-wheel tyre entries are left out. `damage` is the DAMAGE: entry's
 * settings, the one part of the menu that changed during the recording.
 */
const pitMenu = (damage: { text: string }[]) => ({
  pitMenu: [
    {
      'PMC Value': 2,
      currentSetting: 0,
      default: 0,
      name: 'DAMAGE:',
      settings: damage,
    },
    {
      'PMC Value': 6,
      currentSetting: 45,
      default: 100,
      name: 'VIRTUAL ENERGY:',
      // Its `settings` are left out: 101 of them, "0% 0 laps" to
      // "100% 44 laps", one per whole percent, so the index is the level.
    },
    {
      'PMC Value': 7,
      currentSetting: 102,
      default: 49,
      name: 'FUEL RATIO:',
      // Whole, since the ratio is read from the text at the index: 120
      // settings, "0.01" to "1.20".
      settings: Array.from({ length: 120 }, (_, index) => ({
        text: ((index + 1) / 100).toFixed(2),
      })),
    },
    {
      'PMC Value': 8,
      currentSetting: 0,
      default: 0,
      name: 'TIRES:',
      settings: [
        { text: 'No Change' },
        { isUsed: false, text: 'New Medium ', type: 'Medium' },
        { isUsed: false, text: 'New Wet ', type: 'Wet' },
        { isUsed: true, text: 'INVALID', type: 'Medium' },
        { isUsed: true, text: 'Mixed Tyres', type: 'Wet' },
      ],
    },
    {
      'PMC Value': 35,
      currentSetting: 0,
      default: 0,
      name: 'REPLACE BRAKES:',
      settings: [{ text: 'No' }, { text: 'Yes' }],
    },
  ],
});

/** Which of the car's eighteen detachable parts are fitted; not decoded. */
const detachableParts = () => [
  true,
  true,
  true,
  true,
  false,
  true,
  ...Array.from({ length: 12 }, () => false),
];

/**
 * GET /rest/garage/UIScreen/RepairAndRefuel, the recording's first answer: an
 * undamaged car on new discs.
 *
 * `wearables.brakes` is disc thickness in metres, and `suspension` reads
 * zeros while nothing is bent. `racePosition`, `teamInfo`,
 * `pitRecommendations` and `weatherForecast` are left out.
 */
export const repairAndRefuelFixture = () => ({
  // Kept though nothing reads them: the two blocks that make this body
  // differ on every poll of a running car.
  currentWeather: {
    airPressure: 99,
    ambientTempKelvin: 290.29936425243704,
    cloudCoverage: 0.07134092933674474,
    humidity: 0.5,
    lightLevel: 1,
    rainIntensity: 0,
    raining: 0,
    trackTempKelvin: 314.6165893393701,
  },
  sessionTime: { timeOfDay: 54739.921875 },
  fuelInfo: {
    currentBattery: 0,
    currentFuel: 44.91963195800781,
    currentVirtualEnergy: 348750016,
    maxBattery: 0,
    maxFuel: 120,
    maxVirtualEnergy: 775000000,
  },
  pitMenu: pitMenu([{ text: 'N/A' }]),
  pitStopLength: { timeInSeconds: 2.4206960201263428 },
  pitStopTimes: pitStopTimes(),
  wearables: {
    body: { aero: 0, detachableParts: detachableParts() },
    brakes: [
      0.03599979553791755, 0.03599977387436675, 0.03199990716465387,
      0.031999903813298716,
    ],
    suspension: [0, 0, 0, 0],
    tires: [
      0.9838294974209738, 0.9836724350988304, 0.9828878155148248,
      0.983040182565845,
    ],
  },
});

/**
 * The same screen four minutes on, the recording's last answer, after the
 * car took a knock at the nose: aero damage above zero, and a DAMAGE: entry
 * that now offers a choice where it read "N/A".
 */
export const repairAndRefuelDamagedFixture = () => ({
  currentWeather: {
    airPressure: 99,
    ambientTempKelvin: 289.15,
    cloudCoverage: 0.08706490197120878,
    humidity: 0.5,
    lightLevel: 1,
    rainIntensity: 0,
    raining: 0,
    trackTempKelvin: 314.4543061307334,
  },
  sessionTime: { timeOfDay: 54979.73828125 },
  fuelInfo: {
    currentBattery: 0,
    currentFuel: 38.63039779663086,
    currentVirtualEnergy: 300327232,
    maxBattery: 0,
    maxFuel: 120,
    maxVirtualEnergy: 775000000,
  },
  pitMenu: pitMenu([{ text: 'Do Not Repair' }, { text: 'Repair Body' }]),
  pitStopLength: { timeInSeconds: 4.270501136779785 },
  pitStopTimes: pitStopTimes(),
  wearables: {
    body: { aero: 0.026761913672089577, detachableParts: detachableParts() },
    brakes: [
      0.03599507809643654, 0.03599397122263648, 0.031997911016507986,
      0.03199759204197487,
    ],
    suspension: [0, 0, 0, 0],
    tires: [
      0.9736882319656556, 0.9714933281909072, 0.9695360793759351,
      0.9686788707353998,
    ],
  },
});

/**
 * Made by hand, not recorded: the screen of a fuel-limited car, whose menu
 * offers FUEL as a volume where the recorded car's offers VIRTUAL ENERGY and
 * FUEL RATIO. The tape has no such car: the entry has the shape TinyPedal's
 * adapter reads and its texts are invented. Everything outside the menu is
 * the recorded body.
 */
export const repairAndRefuelFuelCarFixture = () => ({
  ...repairAndRefuelFixture(),
  pitMenu: {
    pitMenu: [
      { name: 'TIRES:', currentSetting: 0, settings: [{ text: 'No Change' }] },
      {
        name: 'FUEL:',
        currentSetting: 2,
        settings: [{ text: '+0 L' }, { text: '+10 L' }, { text: '+45 L' }],
      },
    ],
  },
});

/**
 * GET /rest/sessions, three of the recording's 62 settings: the two the task
 * reads and one it does not.
 */
export const sessionsFixture = () => ({
  SESSSET_private_qual: {
    currentValue: 1,
    numStepsTotal: 2,
    settingID: 33,
    stringValue: 'On',
    uiSelectionType: 'Arrow',
    valueType: 'LONG',
  },
  SESSSET_race_timescale: {
    currentValue: 1,
    numStepsTotal: 61,
    settingID: 32,
    stringValue: 'Normal',
    uiSelectionType: 'Arrow',
    valueType: 'LONG',
  },
  SESSSET_timescaled_weather: {
    currentValue: 1,
    numStepsTotal: 1,
    settingID: 24,
    stringValue: 'On',
    uiSelectionType: 'Switch',
    valueType: 'LONG',
  },
});

/** How the sim words the sky types and wind directions the recording has. */
const SKY_NAMES = ['Clear', 'Light Clouds', 'Partially Cloudy'];
const WIND_NAMES: Record<number, string> = { 6: 'West', 7: 'North West' };

/**
 * One forecast point, as LMU nests it: each figure with the text the sim
 * shows for it. The wind is metres per second, worded in km/h. No point of
 * the recording has any chance of rain.
 */
const node = (
  sky: number,
  temperature: number,
  humidity: number,
  windSpeed: number,
  windDirection: number
) => ({
  WNV_HUMIDITY: { currentValue: humidity, stringValue: `${humidity}%` },
  WNV_RAIN_CHANCE: { currentValue: 0, stringValue: '0%' },
  WNV_SKY: { currentValue: sky, stringValue: SKY_NAMES[sky] },
  WNV_TEMPERATURE: {
    currentValue: temperature,
    stringValue: `${temperature} °`,
  },
  WNV_WINDDIRECTION: {
    currentValue: windDirection,
    stringValue: WIND_NAMES[windDirection],
  },
  WNV_WINDSPEED: {
    currentValue: windSpeed,
    stringValue: `${(windSpeed * 3.6).toFixed(1)} kph`,
  },
});

/** GET /rest/sessions/weather, whole. */
export const weatherFixture = () => ({
  PRACTICE: {
    START: node(1, 21, 54, 13, 7),
    NODE_25: node(1, 21, 50, 15, 7),
    NODE_50: node(0, 22, 48, 17, 7),
    NODE_75: node(0, 22, 47, 14, 7),
    FINISH: node(0, 22, 46, 11, 7),
  },
  QUALIFY: {
    START: node(0, 23, 29, 22, 6),
    NODE_25: node(0, 20, 30, 12, 6),
    NODE_50: node(0, 19, 32, 15, 6),
    NODE_75: node(0, 14, 34, 15, 6),
    FINISH: node(0, 21, 38, 9, 6),
  },
  RACE: {
    START: node(0, 18, 56, 17, 6),
    NODE_25: node(1, 17, 60, 17, 7),
    NODE_50: node(1, 16, 62, 17, 7),
    NODE_75: node(1, 16, 54, 14, 7),
    FINISH: node(2, 16, 57, 11, 7),
  },
});

/**
 * GET /rest/garage/UIScreen/TireManagement. Made by hand: the recorder does
 * not poll this path.
 *
 * Only the part that matters here: `compounds` is a list, and an entry's
 * position in it is the compound index per-wheel telemetry reports. The
 * optimal temperature rides along in the real payload and nothing reads it,
 * so it is kept to prove the parser ignores it rather than trips on it.
 */
export const tireManagementFixture = () => ({
  optimalCompoundConditions: {
    compounds: [
      { type: 'Hard', optimalTemperature: 85 },
      { type: 'Medium', optimalTemperature: 90 },
      { type: 'Soft', optimalTemperature: 95 },
      { type: 'Wet', optimalTemperature: 45 },
    ],
  },
  tireInventory: {
    maxAvailableTires: 20,
    bestConditionsUsed: [
      [0, 0],
      [1, 1],
    ],
  },
});

/** A garage value with the members every one of them carries. */
const garageValue = (
  key: string,
  stringValue: string,
  value: number,
  maxValue: number,
  lastSavedStringValue = stringValue
) => ({
  available: true,
  diffComparisonValue: 0,
  isFreeSetting: true,
  key,
  lastSavedStringValue,
  maxValue,
  minValue: 0,
  numChangesValue: 0,
  stringValue,
  value,
});

/**
 * GET /rest/garage/UIScreen/CarSetupOverview, eleven of the 172 entries of
 * the recording's `garageValues`, each whole.
 *
 * How a garage value reads: `stringValue` is the quantity as text, `value`
 * the position of the slider and `maxValue` the number of positions, so a
 * `maxValue` of 1 is a setting with nothing to choose. The fuel ratio shows
 * all three at once: "1.03" at position 102 of 120. The recorded car has no
 * regeneration and no electric motor, and reads a single position for both.
 *
 * The three fuel values agree with each other, as the garage derives them
 * from one slider: 45 % at 1.03 L per percent is the 46.4 L it shows.
 */
export const carSetupOverviewFixture = () => ({
  carSetup: {
    garageValues: {
      VM_ELECTRIC_MOTOR_MAP: garageValue('VM_ELECTRIC_MOTOR_MAP', '0', 0, 1),
      VM_FUEL_CAPACITY: garageValue(
        'VM_FUEL_CAPACITY',
        '46.4L (20.6 laps)',
        0,
        1
      ),
      VM_FUEL_LEVEL: garageValue('VM_FUEL_LEVEL', '1.03', 102, 120, '0.01'),
      VM_REGEN_LEVEL: garageValue('VM_REGEN_LEVEL', '0%', 0, 1),
      VM_STEER_LOCK: {
        ...garageValue(
          'VM_STEER_LOCK',
          '476 (17.2) deg',
          6,
          7,
          '240 (8.7) deg'
        ),
        caption: 'Wheel Range (Lock)',
      },
      VM_VIRTUAL_ENERGY: {
        ...garageValue(
          'VM_VIRTUAL_ENERGY',
          '45% (20.1 laps)',
          45,
          101,
          '44% (19.6 laps)'
        ),
        numChangesValue: -55,
      },
      'WM_BRAKEDISC-W_FL': garageValue('WM_BRAKEDISC-W_FL', '3.60 cm', 0, 1),
      'WM_BRAKEDISC-W_FR': garageValue('WM_BRAKEDISC-W_FR', '3.60 cm', 0, 1),
      'WM_BRAKEDISC-W_RL': garageValue('WM_BRAKEDISC-W_RL', '3.20 cm', 0, 1),
      'WM_BRAKEDISC-W_RR': garageValue('WM_BRAKEDISC-W_RR', '3.20 cm', 0, 1),
      'WM_BRAKEPAD-W_FL': garageValue('WM_BRAKEPAD-W_FL', '1', 0, 1),
    },
  },
  // Kept though nothing reads it: what makes this body differ on every poll.
  sessionTime: { timeOfDay: 54739.953125 },
});

/**
 * GET /rest/watch/standings, two entries trimmed to the keys the task reads.
 * Not on the tape, whose recorder does not poll this path.
 *
 * Values are from a captured payload, including the detail that matters: the
 * entry name carries the season ("Proton Competition 2026 #77:LM") where
 * `fullTeamName` does not. The live fields are kept on one entry as a reminder
 * that this body changes on every poll, which is why the task is slow.
 */
export const watchStandingsFixture = () => [
  {
    slotID: 5,
    driverName: 'jun lira',
    fullTeamName: 'Proton Competition',
    vehicleName: 'Proton Competition 2026 #77:LM',
    carNumber: '77',
    position: 3,
    focus: true,
    hasFocus: true,
    penalties: 0,
    carVelocity: { velocity: 33.6552619934082, x: 0.685, y: -0.136, z: -33.6 },
    timeIntoLap: 74.75196075439453,
  },
  {
    slotID: 8,
    driverName: 'Herve Attard',
    fullTeamName: 'Vista AF Corse',
    vehicleName: 'Vista AF Corse 2026 #21:LM',
    carNumber: '21',
    position: 4,
    focus: false,
    hasFocus: false,
    penalties: 1,
  },
];
