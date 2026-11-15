import { describe, expect, it } from 'vitest';
import {
  CAR_SYSTEM_ADJUSTMENTS,
  CAR_SYSTEM_LABEL_OVERRIDES,
  DEFAULT_CAR_SYSTEM_ROWS,
  DEFAULT_LMU_CAR_SYSTEM_ROWS,
  LMU_DIAL_KEYS,
  carSystemIsRenamedSomewhere,
  carSystemSupportsSim,
  carSystemsForSim,
  normalizeCarPath,
  resolveCarSystemDefinition,
} from './carSystems';
import { SIMULATOR_IDS } from './simulators';

const definitionFor = (key: string) => {
  const definition = CAR_SYSTEM_ADJUSTMENTS.find((d) => d.key === key);
  if (!definition) throw new Error(`no catalogue entry for ${key}`);
  return definition;
};

describe('normalizeCarPath', () => {
  it('ignores case and punctuation', () => {
    expect(normalizeCarPath('CadillacVSeriesRGTP')).toBe('cadillacvseriesrgtp');
    expect(normalizeCarPath('cadillac vseriesr gtp')).toBe(
      'cadillacvseriesrgtp'
    );
    expect(normalizeCarPath('mx5 mx52016')).toBe('mx5mx52016');
  });
});

describe('resolveCarSystemDefinition', () => {
  const abs = definitionFor('dcABS');

  it('keeps the catalogue name for a car with no override', () => {
    expect(resolveCarSystemDefinition(abs, 'bmwm4gt3')).toEqual(abs);
  });

  it('keeps the catalogue name before session data names the car', () => {
    expect(resolveCarSystemDefinition(abs, undefined)).toEqual(abs);
    expect(resolveCarSystemDefinition(abs, '')).toEqual(abs);
  });

  it('renames a channel the car wires to a different control', () => {
    // GTP cars have no ABS to adjust; dcABS is the brake migration dial.
    const resolved = resolveCarSystemDefinition(abs, 'cadillacvseriesrgtp');

    expect(resolved.label).toBe('Brake Migration');
    expect(resolved.short).toBe('MIGR');
  });

  it('keeps ABS named ABS on a car that really has it', () => {
    // The GT3 captures publish dcABS positive with no dcBrakeMisc alongside,
    // which is the shape of a real ABS dial rather than a migration one.
    for (const carPath of ['bmwm4gt3', 'ferrari296gt3', 'porsche992rgt3']) {
      expect(resolveCarSystemDefinition(abs, carPath).label).toBe('ABS');
    }
  });

  it('renames the valve channel only on the car that repurposes it', () => {
    // The Clio and the TCR both use it as a rear brake valve, so that is the
    // catalogue name and neither needs an entry. The W13 is the exception.
    const valve = definitionFor('dcPeakBrakeBias');

    expect(resolveCarSystemDefinition(valve, 'renaultcliocup').label).toBe(
      'Rear Brake Valve'
    );
    expect(resolveCarSystemDefinition(valve, 'mercedesw13').label).toBe(
      'Brake Migration'
    );
  });

  it('renames only the adjustments the car overrides', () => {
    const bias = definitionFor('dcBrakeBias');

    expect(resolveCarSystemDefinition(bias, 'cadillacvseriesrgtp')).toEqual(
      bias
    );
  });

  it('keeps the telemetry key, so a saved row selection still matches', () => {
    // The whole point of overriding display strings alone: `rows` persists
    // keys, so switching into an overriding car must not orphan the row.
    const resolved = resolveCarSystemDefinition(abs, 'cadillacvseriesrgtp');

    expect(resolved.key).toBe('dcABS');
    expect(DEFAULT_CAR_SYSTEM_ROWS).toContain(resolved.key);
  });

  it('leaves the scale, formatting and chip colour alone', () => {
    // The chip is deliberately not overridable: a column that changed colour
    // on a car change would break the positional constancy the widget trades
    // on, even where the renamed control belongs to a different system.
    const resolved = resolveCarSystemDefinition(abs, 'cadillacvseriesrgtp');

    expect(resolved.precision).toBe(abs.precision);
    expect(resolved.unit).toBe(abs.unit);
    expect(resolved.chip).toBe(abs.chip);
    expect(resolved.signed).toBe(abs.signed);
  });
});

describe('CAR_SYSTEM_ADJUSTMENTS', () => {
  it('has no duplicate keys', () => {
    const keys = CAR_SYSTEM_ADJUSTMENTS.map((d) => d.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declares the scales that are centred on zero', () => {
    // These three sit at a neutral 0 for whole sessions - the jacker on any
    // road course, the bias target on the W13 - so the processor's "saw a
    // negative once" rule never fires and 0 would report as switched off.
    const signed = CAR_SYSTEM_ADJUSTMENTS.filter((d) => d.signed).map(
      (d) => d.key
    );

    expect(signed.sort()).toEqual([
      'dcBrakeBiasFine',
      'dcBrakeMisc',
      'dcWeightJackerRight',
    ]);
  });

  it('gives every row its own chip colour among the rows of one sim', () => {
    // Two columns in the same colour read as the same system at a glance,
    // which is the one thing the chips exist to prevent. Only columns of one
    // simulator are ever on screen together, and an LMU dial deliberately
    // repeats the colour of the iRacing channel for the same kind of control.
    for (const simulator of SIMULATOR_IDS) {
      const chips = carSystemsForSim(simulator).map((d) => d.chip);

      expect(new Set(chips).size, simulator).toBe(chips.length);
    }
  });

  it('declares the dials whose position 0 is a setting', () => {
    const settingAtZero = CAR_SYSTEM_ADJUSTMENTS.filter(
      (d) => d.offAtZero === false
    ).map((d) => d.key);

    expect(settingAtZero.sort()).toEqual([
      'LmuBrakeMigration',
      'LmuMotorMap',
      'LmuWiper',
    ]);
  });
});

describe('the rows of each simulator', () => {
  const keysFor = (simulator: 'iracing' | 'lmu') =>
    carSystemsForSim(simulator).map((d) => d.key);

  it('offers Le Mans Ultimate its own dials in the order they are drawn', () => {
    expect(keysFor('lmu')).toEqual([
      'dcBrakeBias',
      'dcABS',
      'dcTractionControl',
      'LmuTcSlip',
      'LmuTcCut',
      'LmuBrakeMigration',
      'LmuMotorMap',
      'LmuRegenLevel',
      'dcAntiRollFront',
      'dcAntiRollRear',
      'LmuWiper',
    ]);
  });

  it('offers iRacing every entry there was before, and none of the LMU ones', () => {
    const iracing = keysFor('iracing');

    expect(iracing).toHaveLength(21);
    expect(iracing.filter((key) => key.startsWith('Lmu'))).toEqual([]);
    // The slots LMU's dials used to be squeezed into are iRacing's alone.
    expect(keysFor('lmu')).not.toContain('dcTractionControl2');
    expect(keysFor('lmu')).not.toContain('dcEnginePower');
  });

  it('treats an entry with no sims as iRacing only', () => {
    const throttle = definitionFor('dcThrottleShape');

    expect(throttle.sims).toBeUndefined();
    expect(carSystemSupportsSim(throttle, 'iracing')).toBe(true);
    expect(carSystemSupportsSim(throttle, 'lmu')).toBe(false);
  });

  it('defaults each sim to rows that sim publishes', () => {
    expect(
      DEFAULT_CAR_SYSTEM_ROWS.filter((key) => !keysFor('iracing').includes(key))
    ).toEqual([]);
    expect(
      DEFAULT_LMU_CAR_SYSTEM_ROWS.filter((key) => !keysFor('lmu').includes(key))
    ).toEqual([]);
    // Offered under LMU and off until asked for.
    for (const key of [
      'dcAntiRollFront',
      'dcAntiRollRear',
      'LmuWiper',
      'LmuRegenLevel',
    ]) {
      expect(DEFAULT_LMU_CAR_SYSTEM_ROWS).not.toContain(key);
    }
  });

  it('keeps the default LMU rows in catalogue order', () => {
    // Settings re-sorts a selection into catalogue order when a row is
    // toggled, so a default in any other order would jump on first use.
    const order = keysFor('lmu');
    const positions = DEFAULT_LMU_CAR_SYSTEM_ROWS.map((key) =>
      order.indexOf(key)
    );

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('lists a dial maximum only for dials LMU publishes', () => {
    for (const key of LMU_DIAL_KEYS) {
      expect(keysFor('lmu'), key).toContain(key);
    }
    // A split, a mode and a garage figure: none has a scale of positions.
    expect(LMU_DIAL_KEYS).not.toContain('dcBrakeBias');
    expect(LMU_DIAL_KEYS).not.toContain('LmuWiper');
    expect(LMU_DIAL_KEYS).not.toContain('LmuRegenLevel');
  });

  it('names the four wiper states', () => {
    expect(definitionFor('LmuWiper').valueLabels).toEqual([
      'OFF',
      'AUTO',
      'SLOW',
      'FAST',
    ]);
  });
});

describe('CAR_SYSTEM_LABEL_OVERRIDES', () => {
  it('only overrides keys the catalogue knows about', () => {
    // A typo'd key would silently never match, so it is caught here rather
    // than by a column that quietly keeps its generic name in the sim.
    const known = new Set(CAR_SYSTEM_ADJUSTMENTS.map((d) => d.key));

    for (const [carPath, overrides] of Object.entries(
      CAR_SYSTEM_LABEL_OVERRIDES
    )) {
      for (const key of Object.keys(overrides)) {
        expect(known, `${carPath} overrides unknown key ${key}`).toContain(key);
      }
    }
  });

  it('is keyed by already-normalized car paths', () => {
    for (const carPath of Object.keys(CAR_SYSTEM_LABEL_OVERRIDES)) {
      expect(normalizeCarPath(carPath)).toBe(carPath);
    }
  });
});

describe('carSystemIsRenamedSomewhere', () => {
  it('reports the keys settings should caveat', () => {
    expect(carSystemIsRenamedSomewhere('dcABS')).toBe(true);
    expect(carSystemIsRenamedSomewhere('dcBrakeBias')).toBe(false);
  });
});
