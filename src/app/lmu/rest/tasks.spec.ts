import { describe, expect, it } from 'vitest';
import {
  at,
  finiteNumber,
  LMU_PIT_STOP_PARTS,
  LMU_REST_TASKS,
  LMU_TEAMS_TASK_ID,
} from './tasks';
import { createLmuRestData, type LmuRestData } from './state';
import {
  pitstopEstimateFixture,
  pitstopEstimateLateFixture,
  repairAndRefuelFixture,
  repairAndRefuelDamagedFixture,
  repairAndRefuelFuelCarFixture,
  carSetupOverviewFixture,
  sessionsFixture,
  weatherFixture,
  tireManagementFixture,
  watchStandingsFixture,
} from './restFixture';

const taskById = (id: string) => {
  const task = LMU_REST_TASKS.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`no task ${id}`);
  return task;
};

const outputById = (taskId: string, id: string) => {
  const output = taskById(taskId).outputs.find(
    (candidate) => candidate.id === id
  );
  if (!output) throw new Error(`no output ${id} in ${taskId}`);
  return output;
};

/**
 * Runs a task's outputs over a payload, as the poller does. Into `data` when
 * one is given, for what a second answer does to the first.
 */
const apply = (
  id: string,
  payload: unknown,
  data: LmuRestData = createLmuRestData()
) => {
  const applied: string[] = [];
  taskById(id).outputs.forEach((output) => {
    const value = output.parse(payload);
    if (value === undefined) return;
    if (output.unchanged?.(data, value)) return;
    output.apply(data, value);
    applied.push(output.id);
  });
  return { data, applied };
};

/** The named entry of a fixture's pit menu, loosely typed so it can be bent. */
const menuEntry = (
  payload: { pitMenu: { pitMenu: { name: string }[] } },
  name: string
) => {
  const entry = payload.pitMenu.pitMenu.find(
    (candidate) => candidate.name === name
  );
  if (!entry) throw new Error(`no menu entry ${name}`);
  return entry as {
    name: string;
    currentSetting: unknown;
    settings?: unknown;
  };
};

describe('at', () => {
  it('walks a key path', () => {
    expect(at({ a: { b: { c: 7 } } }, ['a', 'b', 'c'])).toBe(7);
  });

  it('gives up rather than throwing on a missing or non-object link', () => {
    expect(at({ a: 1 }, ['a', 'b'])).toBeUndefined();
    expect(at({}, ['a', 'b', 'c'])).toBeUndefined();
    expect(at(null, ['a'])).toBeUndefined();
    expect(at(undefined, ['a'])).toBeUndefined();
    expect(at('a string', ['length'])).toBeUndefined();
  });

  it('returns the payload itself for an empty path', () => {
    expect(at({ a: 1 }, [])).toEqual({ a: 1 });
  });
});

describe('finiteNumber', () => {
  it('accepts only finite numbers', () => {
    expect(finiteNumber(0)).toBe(0);
    expect(finiteNumber(-1.5)).toBe(-1.5);
  });

  it('rejects everything else, including numeric strings', () => {
    // A numeric string would otherwise reach a telemetry cell typed number.
    [NaN, Infinity, -Infinity, '12', '', null, undefined, {}, [], true].forEach(
      (value) => expect(finiteNumber(value)).toBeUndefined()
    );
  });
});

describe('pitstop-estimate task', () => {
  it('reads the stop and repair estimates', () => {
    const { data, applied } = apply(
      'pitstop-estimate',
      pitstopEstimateFixture()
    );

    expect(data.cells.pitStopTime?.value[0]).toBe(2.420665740966797);
    // An undamaged car. Zero is a reading and is published as one.
    expect(data.cells.repairTime?.value[0]).toBe(0);
    expect(applied).toEqual([
      'pitStopTime',
      'repairTime',
      'penaltySeconds',
      'pitStopParts',
    ]);
  });

  it('reads a repair time where there is damage to repair', () => {
    const { data } = apply('pitstop-estimate', {
      ...pitstopEstimateFixture(),
      damage: 12.25,
    });

    expect(data.cells.repairTime?.value[0]).toBe(12.25);
  });

  it('is a repeating task, since the estimate moves with damage', () => {
    expect(taskById('pitstop-estimate').mode).toBe('repeat');
  });

  it('writes nothing to the session, so it cannot force a republish', () => {
    // Everything here is on the ungated telemetry path by design -- a session
    // target would rebuild the whole snapshot on every poll.
    taskById('pitstop-estimate').outputs.forEach((output) =>
      expect(output.target).toBe('telemetry')
    );
  });

  it('applies nothing when the keys are missing', () => {
    const { data, applied } = apply('pitstop-estimate', {});

    expect(applied).toEqual([]);
    expect(data.cells.pitStopTime).toBeUndefined();
  });

  it('applies only what it recognises from a partial payload', () => {
    const { data, applied } = apply('pitstop-estimate', { total: 20 });

    expect(data.cells.pitStopTime?.value[0]).toBe(20);
    expect(data.cells.repairTime).toBeUndefined();
    expect(applied).toEqual(['pitStopTime']);
  });

  it('survives a wholesale garbage payload without throwing', () => {
    // LMU's shapes change between builds; a surprise must cost one missing
    // property, not a dead poller.
    [
      { error: 'nope' },
      null,
      undefined,
      'a string',
      42,
      [],
      { total: 'soon', damage: null },
      { total: { nested: 1 } },
    ].forEach((payload) => {
      expect(() => apply('pitstop-estimate', payload)).not.toThrow();
      expect(apply('pitstop-estimate', payload).applied).toEqual([]);
    });
  });
});

describe('pitstop-estimate parts', () => {
  it('publishes the eight parts of the stop in one cell, in a fixed order', () => {
    const { data } = apply('pitstop-estimate', {
      total: 9,
      fuel: 1,
      ve: 2,
      tires: 3,
      damage: 4,
      driverSwap: 5,
      brakes: 6,
      brakeDucts: 7,
      penalties: 8,
    });

    expect(data.cells.pitStopParts?.value).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(LMU_PIT_STOP_PARTS).toEqual([
      'fuel',
      've',
      'tires',
      'damage',
      'driverSwap',
      'brakes',
      'brakeDucts',
      'penalties',
    ]);
  });

  it('reads what the sim sent: fuel and energy overlap, they do not add up', () => {
    // The recording's last answer. The total is the fuel part alone, with
    // the energy going in alongside it.
    const { data } = apply('pitstop-estimate', pitstopEstimateLateFixture());

    expect(data.cells.pitStopParts?.value).toEqual([
      4.27047061920166, 2.4992382526397705, 0, 0, 0, 0, 0, 0,
    ]);
    expect(data.cells.pitStopTime?.value[0]).toBe(4.27047061920166);
  });

  it('publishes no parts when one of the eight is missing', () => {
    // The cell is read by position, so seven would be read as eight shifted.
    const payload = pitstopEstimateFixture() as Record<string, unknown>;
    delete payload.brakeDucts;

    const { data, applied } = apply('pitstop-estimate', payload);

    expect(data.cells.pitStopParts).toBeUndefined();
    // The values with cells of their own still land.
    expect(applied).toEqual(['pitStopTime', 'repairTime', 'penaltySeconds']);
  });

  it('publishes no parts when one of them is not a number', () => {
    [null, '3.2', NaN, {}, true].forEach((tires) => {
      const { data } = apply('pitstop-estimate', {
        ...pitstopEstimateFixture(),
        tires,
      });
      expect(data.cells.pitStopParts).toBeUndefined();
    });
  });

  it('keeps the parts already held through an answer without them', () => {
    const { data } = apply('pitstop-estimate', pitstopEstimateLateFixture());
    apply('pitstop-estimate', { total: 5 }, data);

    expect(data.cells.pitStopParts?.value[0]).toBe(4.27047061920166);
  });
});

describe('LMU_REST_TASKS', () => {
  it('gives every task a distinct id and a sane interval', () => {
    const ids = LMU_REST_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    LMU_REST_TASKS.forEach((task) => {
      expect(task.baseIntervalMs).toBeGreaterThan(0);
      expect(task.path.startsWith('/rest/')).toBe(true);
      expect(task.outputs.length).toBeGreaterThan(0);
    });
  });

  it('gives every output a distinct id within its task', () => {
    LMU_REST_TASKS.forEach((task) => {
      const ids = task.outputs.map((output) => output.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('compares every session value read from a body that moves by itself', () => {
    // The repair screen and the setup overview carry the time of day, so in
    // a running session their bodies differ on every poll; the forecast is
    // asked for all session long. A session target without a comparator
    // rebuilds and rebroadcasts the whole session for each of those answers.
    ['repair-and-refuel', 'car-setup-overview', 'sessions-weather'].forEach(
      (id) => {
        expect(taskById(id).mode).toBe('repeat');
        taskById(id)
          .outputs.filter((output) => output.target === 'session')
          .forEach((output) =>
            expect(output.unchanged, `${id}/${output.id}`).toBeDefined()
          );
      }
    );
  });

  it('leaves the session alone for a second answer that says the same', () => {
    const answers: [string, () => unknown][] = [
      ['repair-and-refuel', repairAndRefuelFixture],
      ['car-setup-overview', carSetupOverviewFixture],
      ['sessions-weather', weatherFixture],
    ];
    answers.forEach(([id, fixture]) => {
      const { data } = apply(id, fixture());
      const session = { ...data.session };

      const second = apply(id, fixture(), data);

      const reapplied = second.applied.filter(
        (outputId) => outputById(id, outputId).target === 'session'
      );
      expect(reapplied, id).toEqual([]);
      expect(data.session).toEqual(session);
    });
  });
});

describe('repair-and-refuel task', () => {
  it('reads damage from the wearables block', () => {
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    // An undamaged car reads zero for all of it: zero is "nothing bent",
    // not "nothing left".
    expect(data.cells.aeroDamage?.value[0]).toBe(0);
    // LF, RF, LR, RR -- LMU's order and this repo's are the same, so there is
    // no remapping here and nobody should add one.
    expect(data.cells.suspensionDamage?.value).toEqual([0, 0, 0, 0]);
  });

  it('reads the aero damage a knock at the nose leaves', () => {
    const { data } = apply(
      'repair-and-refuel',
      repairAndRefuelDamagedFixture()
    );

    expect(data.cells.aeroDamage?.value[0]).toBe(0.026761913672089577);
    expect(data.cells.suspensionDamage?.value).toEqual([0, 0, 0, 0]);
  });

  it('reads a fuel target in litres and flags it as fuel', () => {
    const { data } = apply(
      'repair-and-refuel',
      repairAndRefuelFuelCarFixture()
    );

    expect(data.cells.refuelTarget?.value[0]).toBe(45);
    expect(data.cells.refuelTargetIsVirtualEnergy?.value[0]).toBe(false);
  });

  it('converts a gallon target to litres', () => {
    const payload = repairAndRefuelFuelCarFixture();
    payload.pitMenu.pitMenu[1].settings = [{ text: '+12.5 gal' }];
    payload.pitMenu.pitMenu[1].currentSetting = 0;

    const { data } = apply('repair-and-refuel', payload);

    // 12.5 US gallons at 3.7854118 L/gal.
    expect(data.cells.refuelTarget?.value[0]).toBeCloseTo(47.32, 2);
    expect(data.cells.refuelTargetIsVirtualEnergy?.value[0]).toBe(false);
  });

  it('reads a virtual-energy target as a percentage and flags it', () => {
    // An energy-limited car. The flag is the only thing distinguishing 45%
    // from 45 litres, so it has to travel with the number. The entry was on
    // "45% 20 laps", with the car at 45.0 %: a level, not an amount to add.
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    expect(data.cells.refuelTarget?.value[0]).toBe(45);
    expect(data.cells.refuelTargetIsVirtualEnergy?.value[0]).toBe(true);
  });

  it('prefers virtual energy when the menu offers both', () => {
    // Not a menu the recording has: a FUEL entry is added after the energy
    // one, which comes first and wins.
    const payload = repairAndRefuelFixture();
    (payload.pitMenu.pitMenu as unknown[]).push({
      name: 'FUEL:',
      currentSetting: 1,
      settings: [{ text: '+0 L' }, { text: '+30 L' }],
    });

    const { data } = apply('repair-and-refuel', payload);

    expect(data.cells.refuelTarget?.value[0]).toBe(45);
    expect(data.cells.refuelTargetIsVirtualEnergy?.value[0]).toBe(true);
  });

  it('sends maxVirtualEnergy to the session, not to telemetry', () => {
    // A per-car constant. On telemetry it would force a session rebuild on
    // every one of these 5 Hz polls.
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    expect(data.session.maxVirtualEnergy).toBe(775000000);
    expect(outputById('repair-and-refuel', 'maxVirtualEnergy').target).toBe(
      'session'
    );
  });

  it('sends the tank size to the session as well', () => {
    // The pit screen states the tank outright, which is the one source for it
    // that is not an inference.
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    expect(data.session.maxFuel).toBe(120);
  });

  it('leaves the tank unset when the payload has no fuelInfo', () => {
    const payload = repairAndRefuelFixture() as Record<string, unknown>;
    delete payload.fuelInfo;

    const { data } = apply('repair-and-refuel', payload);

    expect(data.session.maxFuel).toBeUndefined();
  });

  it('compares the capacities, since this body moves on every poll', () => {
    // It carries the fuel aboard and the time of day. Without the
    // comparison each poll of a running car rebuilt the session to say what
    // it already said.
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    // The same car four minutes on: every live figure has moved, and the
    // tank and the energy budget have not.
    const later = apply(
      'repair-and-refuel',
      repairAndRefuelDamagedFixture(),
      data
    );

    expect(later.applied).not.toContain('maxVirtualEnergy');
    expect(later.applied).not.toContain('maxFuel');
    expect(
      outputById('repair-and-refuel', 'maxFuel').unchanged?.(data, 110)
    ).toBe(false);
  });

  it('rejects a corner array that is not exactly four long', () => {
    // Publishing three would leave a consumer indexing corner 3 with
    // undefined, which is worse than publishing nothing.
    const payload = repairAndRefuelFixture();
    payload.wearables.brakes = [0.036, 0.036, 0.032];

    const { data } = apply('repair-and-refuel', payload);

    expect(data.cells.brakeThickness).toBeUndefined();
    expect(data.cells.suspensionDamage?.value).toHaveLength(4);
  });

  it('rejects a corner array holding a non-number', () => {
    const payload = repairAndRefuelFixture();
    payload.wearables.brakes = [0.036, 0.036, 0.032, null] as number[];

    expect(
      apply('repair-and-refuel', payload).data.cells.brakeThickness
    ).toBeUndefined();
  });

  it('ignores a fuel entry whose text holds no number', () => {
    const payload = repairAndRefuelFuelCarFixture();
    payload.pitMenu.pitMenu[1].settings = [{ text: 'No Change' }];
    payload.pitMenu.pitMenu[1].currentSetting = 0;

    const { data } = apply('repair-and-refuel', payload);

    expect(data.cells.refuelTarget).toBeUndefined();
  });

  it('ignores a fuel entry whose index is out of range', () => {
    const payload = repairAndRefuelFuelCarFixture();
    payload.pitMenu.pitMenu[1].currentSetting = 99;

    const { data } = apply('repair-and-refuel', payload);

    expect(data.cells.refuelTarget).toBeUndefined();
  });

  it('survives a garbage payload without throwing', () => {
    [
      { error: 'nope' },
      null,
      'string',
      { pitMenu: 7 },
      { pitMenu: { pitMenu: [7, null, 'entry', { name: 'DAMAGE:' }] } },
      { wearables: [] },
      { pitStopTimes: { times: 3 } },
      { pitStopLength: 'soon' },
    ].forEach((payload) => {
      expect(() => apply('repair-and-refuel', payload)).not.toThrow();
    });
  });
});

describe('repair-and-refuel brake thickness', () => {
  it('publishes disc thickness in millimetres, from the metres the sim sends', () => {
    // 0.0360 front and 0.0320 rear at the start of the recording: the 3.60
    // and 3.20 cm of the car's setup. Not a 0..1 share of anything.
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());
    const thickness = data.cells.brakeThickness?.value ?? [];

    expect(thickness).toHaveLength(4);
    [35.9997955379, 35.9997738744, 31.9999071647, 31.9999038133].forEach(
      (mm, wheel) => expect(thickness[wheel]).toBeCloseTo(mm, 9)
    );
  });

  it('reads a worn disc to the micrometre', () => {
    const payload = repairAndRefuelFixture();
    payload.wearables.brakes = [0.0359998, 0.0359998, 0.032, 0.032];

    const { data } = apply('repair-and-refuel', payload);

    // 36.00 at the two decimals a widget shows, and not rounded to it here.
    expect(data.cells.brakeThickness?.value[0]).toBeCloseTo(36.0, 2);
    expect(data.cells.brakeThickness?.value[0]).toBeCloseTo(35.9998, 6);
  });

  it('wears as the recording does', () => {
    const { data } = apply(
      'repair-and-refuel',
      repairAndRefuelDamagedFixture()
    );
    const thickness = data.cells.brakeThickness?.value ?? [];

    // Four minutes of an LMGT3: five and six micrometres at the front.
    expect(thickness[0]).toBeCloseTo(35.995, 3);
    expect(thickness[1]).toBeCloseTo(35.994, 3);
    expect(thickness[2]).toBeCloseTo(31.998, 3);
    expect(thickness[3]).toBeCloseTo(31.998, 3);
  });

  it('publishes nothing when the block is absent', () => {
    const payload = repairAndRefuelFixture() as Record<string, unknown>;
    delete payload.wearables;

    const { data, applied } = apply('repair-and-refuel', payload);

    expect(data.cells.brakeThickness).toBeUndefined();
    expect(applied).not.toContain('brakeThickness');
  });

  it('marks an answer that carried a thickness, through a cell of its own', () => {
    // The poller calls this for every answer that carried one, the same
    // reading included; see poller.spec.ts.
    const data = createLmuRestData();
    const output = outputById('repair-and-refuel', 'brakeThickness');

    output.refreshed?.(data, 7);
    const first = data.cells.wearablesSeq;
    output.refreshed?.(data, 8);

    expect(first?.value).toEqual([7]);
    expect(data.cells.wearablesSeq?.value).toEqual([8]);
    // Replaced, never written into: a frame holding the first keeps it.
    expect(data.cells.wearablesSeq).not.toBe(first);
  });
});

describe('repair-and-refuel pit stop length', () => {
  it('reads the standing time the screen states', () => {
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    expect(data.cells.pitStopLength?.value).toEqual([2.4206960201263428]);
  });

  it('agrees with the estimate asked a moment before', () => {
    // The two fixtures are the recording's first answer on each path,
    // fifteen milliseconds apart.
    const screen = apply('repair-and-refuel', repairAndRefuelFixture()).data;
    const estimate = apply('pitstop-estimate', pitstopEstimateFixture()).data;

    expect(
      Math.abs(
        (screen.cells.pitStopLength?.value[0] ?? 0) -
          (estimate.cells.pitStopTime?.value[0] ?? 0)
      )
    ).toBeLessThan(0.001);
  });

  it('publishes nothing when the figure is absent or not a number', () => {
    const absent = repairAndRefuelFixture() as Record<string, unknown>;
    delete absent.pitStopLength;
    expect(
      apply('repair-and-refuel', absent).data.cells.pitStopLength
    ).toBeUndefined();

    [{ timeInSeconds: '2.4' }, { timeInSeconds: null }, 2.4, {}].forEach(
      (pitStopLength) => {
        const { data } = apply('repair-and-refuel', {
          ...repairAndRefuelFixture(),
          pitStopLength,
        });
        expect(data.cells.pitStopLength).toBeUndefined();
      }
    );
  });
});

describe('repair-and-refuel refuel ratio', () => {
  it('reads the litres per percent the pit menu is set to', () => {
    // Setting 102 of 120, worded "1.03".
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    expect(data.cells.refuelRatio?.value).toEqual([1.03]);
  });

  it('reads the text of the setting, not its index', () => {
    const payload = repairAndRefuelFixture();
    menuEntry(payload, 'FUEL RATIO:').currentSetting = 0;

    const { data } = apply('repair-and-refuel', payload);

    expect(data.cells.refuelRatio?.value).toEqual([0.01]);
  });

  it('publishes nothing for a menu without the entry', () => {
    const { data, applied } = apply(
      'repair-and-refuel',
      repairAndRefuelFuelCarFixture()
    );

    expect(data.cells.refuelRatio).toBeUndefined();
    expect(applied).not.toContain('refuelRatio');
  });

  it('publishes nothing for an entry it cannot read', () => {
    const bend = (change: (entry: ReturnType<typeof menuEntry>) => void) => {
      const payload = repairAndRefuelFixture();
      change(menuEntry(payload, 'FUEL RATIO:'));
      return apply('repair-and-refuel', payload).data.cells.refuelRatio;
    };

    [120, -1, 1.5, '102', null].forEach((index) =>
      expect(
        bend((entry) => {
          entry.currentSetting = index;
        })
      ).toBeUndefined()
    );
    // 'Auto' has no number in it, and a ratio of nothing is not a ratio.
    ['none', [{ text: 'Auto' }], [{ text: '0.00' }], [{ ratio: 1.03 }]].forEach(
      (settings) =>
        expect(
          bend((entry) => {
            entry.currentSetting = 0;
            entry.settings = settings;
          })
        ).toBeUndefined()
    );
  });

  it('is a telemetry cell: the driver can move it on track', () => {
    expect(outputById('repair-and-refuel', 'refuelRatio').target).toBe(
      'telemetry'
    );
  });
});

describe('repair-and-refuel repair choice', () => {
  it('has no cell while there is nothing to repair', () => {
    // An undamaged car's DAMAGE: entry has the one setting "N/A".
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    expect(data.cells.repairChoice).toBeUndefined();
  });

  it('reads the choice once the sim offers one', () => {
    const { data } = apply(
      'repair-and-refuel',
      repairAndRefuelDamagedFixture()
    );

    expect(data.cells.repairChoice?.value).toEqual(['Do Not Repair']);
  });

  it('follows the driver choosing a repair', () => {
    const payload = repairAndRefuelDamagedFixture();
    menuEntry(payload, 'DAMAGE:').currentSetting = 1;

    const { data } = apply('repair-and-refuel', payload);

    expect(data.cells.repairChoice?.value).toEqual(['Repair Body']);
  });

  it('takes the cell down when the choice goes back to "N/A"', () => {
    // Left standing, "Repair Body" would outlive the repair.
    const { data } = apply(
      'repair-and-refuel',
      repairAndRefuelDamagedFixture()
    );
    const frameCell = data.cells.repairChoice;

    apply('repair-and-refuel', repairAndRefuelFixture(), data);

    expect(data.cells.repairChoice).toBeUndefined();
    expect(frameCell?.value).toEqual(['Do Not Repair']);
  });

  it('takes it down for an empty menu, and for one with no such entry', () => {
    const emptied = apply(
      'repair-and-refuel',
      repairAndRefuelDamagedFixture()
    ).data;
    apply('repair-and-refuel', { pitMenu: { pitMenu: [] } }, emptied);
    expect(emptied.cells.repairChoice).toBeUndefined();

    const without = apply(
      'repair-and-refuel',
      repairAndRefuelDamagedFixture()
    ).data;
    apply('repair-and-refuel', repairAndRefuelFuelCarFixture(), without);
    expect(without.cells.repairChoice).toBeUndefined();
  });

  it('reads an empty text and any spelling of "N/A" as no choice', () => {
    ['', '   ', 'n/a', ' N/A '].forEach((text) => {
      const payload = repairAndRefuelDamagedFixture();
      menuEntry(payload, 'DAMAGE:').settings = [{ text }];

      expect(
        apply('repair-and-refuel', payload).data.cells.repairChoice
      ).toBeUndefined();
    });
  });

  it('keeps the choice it holds through an answer it cannot read', () => {
    // No menu at all, or an entry whose setting is not there: neither says
    // that there is nothing to repair.
    const unreadable = repairAndRefuelDamagedFixture();
    menuEntry(unreadable, 'DAMAGE:').currentSetting = 9;
    const textless = repairAndRefuelDamagedFixture();
    menuEntry(textless, 'DAMAGE:').settings = [{ label: 'Repair Body' }];

    [{}, { pitMenu: 7 }, { error: 'nope' }, unreadable, textless].forEach(
      (payload) => {
        const { data } = apply(
          'repair-and-refuel',
          repairAndRefuelDamagedFixture()
        );
        apply('repair-and-refuel', payload, data);

        expect(data.cells.repairChoice?.value).toEqual(['Do Not Repair']);
      }
    );
  });
});

describe('repair-and-refuel pit service', () => {
  const output = () => outputById('repair-and-refuel', 'pitService');

  it('lands what each kind of pit work costs on the session', () => {
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    // Litres per second, a share of the energy budget per second, seconds,
    // and the sim's 0 or 1 for what may run alongside other work. Nothing
    // else of the sim's group: no wing, radiator or pressure change.
    expect(data.session.pitService).toEqual({
      fuelFillRate: 3.4000000953674316,
      fuelInsert: 1,
      fuelRemove: 1,
      fuelTimeConcurrent: 1,
      fuelRandomDelay: 2,
      virtualEnergyFillRate: 0.02500000037252903,
      virtualEnergyInsert: 0,
      virtualEnergyRemove: 0,
      virtualEnergyTimeConcurrent: 1,
      fourTireChange: 12,
      twoTireChange: 4.5,
      tireTimeConcurrent: 0,
      randomTireDelay: 1,
      driverChange: 25,
      driverConcurrent: 1,
      driverRandom: 2,
      fixAeroDamage: 30,
      fixAllDamage: 30,
      fixTimeConcurrent: 0,
      fixRandomDelay: 5,
      brakeChange: 120,
      brakeTimeConcurrent: 0,
    });
    expect(output().target).toBe('session');
  });

  it('accounts for the recorded estimate, which is what the rates are for', () => {
    // Energy: from 45 % aboard to the menu's 45 % is nothing to add at the
    // start. Fuel: the level in percent times the ratio, less the litres
    // aboard, at the fill rate, plus the hose on and off.
    const screen = repairAndRefuelFixture();
    const { data } = apply('repair-and-refuel', screen);
    const service = data.session.pitService ?? {};
    const litres =
      (data.cells.refuelTarget?.value[0] ?? 0) *
        (data.cells.refuelRatio?.value[0] ?? 0) -
      screen.fuelInfo.currentFuel;

    const fuel =
      litres / (service.fuelFillRate ?? 1) +
      (service.fuelInsert ?? 0) +
      (service.fuelRemove ?? 0);

    expect(fuel).toBeCloseTo(pitstopEstimateFixture().fuel, 2);
  });

  it('costs a member the sim leaves out that member alone', () => {
    const payload = repairAndRefuelFixture();
    const times = payload.pitStopTimes.times as Record<string, unknown>;
    delete times.BrakeChange;
    times.FuelFillRate = '3.4';
    times.DriverChange = null;

    const { data } = apply('repair-and-refuel', payload);

    expect(data.session.pitService?.brakeChange).toBeUndefined();
    expect(data.session.pitService?.fuelFillRate).toBeUndefined();
    expect(data.session.pitService?.driverChange).toBeUndefined();
    expect(data.session.pitService?.fourTireChange).toBe(12);
    expect(Object.keys(data.session.pitService ?? {})).toHaveLength(19);
  });

  it('lands nothing when the group is absent or holds nothing it reads', () => {
    const absent = repairAndRefuelFixture() as Record<string, unknown>;
    delete absent.pitStopTimes;
    expect(
      apply('repair-and-refuel', absent).data.session.pitService
    ).toBeUndefined();

    [
      { times: {} },
      { times: 7 },
      { times: { OnTheFlyPressure: false, FrontWingAdjust: 40 } },
      {},
      null,
    ].forEach((pitStopTimes) => {
      const { data, applied } = apply('repair-and-refuel', {
        ...repairAndRefuelFixture(),
        pitStopTimes,
      });
      expect(data.session.pitService).toBeUndefined();
      expect(applied).not.toContain('pitService');
    });
  });

  it('recognises the constants it already holds', () => {
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());

    expect(
      output().unchanged?.(data, output().parse(repairAndRefuelFixture()))
    ).toBe(true);
    // Four minutes on, in a body where everything live has moved.
    expect(
      output().unchanged?.(
        data,
        output().parse(repairAndRefuelDamagedFixture())
      )
    ).toBe(true);
    expect(
      output().unchanged?.(
        createLmuRestData(),
        output().parse(repairAndRefuelFixture())
      )
    ).toBe(false);
  });

  it('sees a rate changing, a member going and a member arriving', () => {
    const { data } = apply('repair-and-refuel', repairAndRefuelFixture());
    const changed = repairAndRefuelFixture();
    changed.pitStopTimes.times.FuelFillRate = 2.5;
    const gone = repairAndRefuelFixture();
    delete (gone.pitStopTimes.times as Record<string, unknown>).BrakeChange;

    expect(output().unchanged?.(data, output().parse(changed))).toBe(false);
    expect(output().unchanged?.(data, output().parse(gone))).toBe(false);

    // And the other way: held without the member, parsed with it.
    const partial = apply('repair-and-refuel', gone).data;
    expect(
      output().unchanged?.(partial, output().parse(repairAndRefuelFixture()))
    ).toBe(false);
  });
});

describe('sessions task', () => {
  it('reads the session settings LMU nests under currentValue', () => {
    // The recorded race ran in real time, worded "Normal", with private
    // qualifying "On".
    const { data } = apply('sessions', sessionsFixture());

    expect(data.session.timeScale).toBe(1);
    expect(data.session.privateQualifying).toBe(true);
    // Fifteen minutes, which the sim holds as 15.
    expect(data.session.raceTime).toBe(900);
  });

  it('reads the race length in seconds, and none from a length of nothing', () => {
    const sixHours = apply('sessions', {
      ...sessionsFixture(),
      SESSSET_race_time: { currentValue: 360 },
    });
    expect(sixHours.data.session.raceTime).toBe(21_600);

    const none = apply('sessions', {
      ...sessionsFixture(),
      SESSSET_race_time: { currentValue: 0 },
    });
    expect(none.data.session.raceTime).toBeUndefined();

    const without: Record<string, unknown> = { ...sessionsFixture() };
    delete without.SESSSET_race_time;
    expect(apply('sessions', without).data.session.raceTime).toBeUndefined();
  });

  it('reads a scaled race as its multiplier', () => {
    const { data } = apply('sessions', {
      ...sessionsFixture(),
      SESSSET_race_timescale: { currentValue: 6 },
    });

    expect(data.session.timeScale).toBe(6);
  });

  it('reads a zero private-qualifying flag as false', () => {
    const { data } = apply('sessions', {
      ...sessionsFixture(),
      SESSSET_private_qual: { currentValue: 0 },
    });

    expect(data.session.privateQualifying).toBe(false);
  });

  it('is fetched once, since session settings cannot change mid-session', () => {
    expect(LMU_REST_TASKS.find((task) => task.id === 'sessions')?.mode).toBe(
      'once'
    );
  });

  it('targets the session, so it forces a republish', () => {
    // These only reach widgets through the session snapshot, which is gated by
    // the signature -- so a telemetry target here would never be published.
    LMU_REST_TASKS.find((task) => task.id === 'sessions')?.outputs.forEach(
      (output) => expect(output.target).toBe('session')
    );
  });

  it('applies nothing for a payload missing the settings', () => {
    expect(apply('sessions', { other: 1 }).applied).toEqual([]);
  });
});

describe('sessions-weather task', () => {
  it('reads five forecast points per session type', () => {
    const { data } = apply('sessions-weather', weatherFixture());

    expect(data.session.forecast?.practice).toHaveLength(5);
    expect(data.session.forecast?.qualify).toHaveLength(5);
    expect(data.session.forecast?.race).toHaveLength(5);
  });

  it('spaces the points evenly across the session', () => {
    const { data } = apply('sessions-weather', weatherFixture());

    expect(data.session.forecast?.race?.map((n) => n.start)).toEqual([
      0, 0.2, 0.4, 0.6, 0.8,
    ]);
  });

  it('normalises rain chance from a percentage to a fraction', () => {
    // So no consumer has to know which convention it arrived in. The
    // recording is dry throughout, so the chances are put in here.
    const payload = weatherFixture();
    payload.RACE.START.WNV_RAIN_CHANCE.currentValue = 30;
    payload.RACE.NODE_50.WNV_RAIN_CHANCE.currentValue = 100;

    const { data } = apply('sessions-weather', payload);
    const race = data.session.forecast?.race ?? [];

    expect(race[0].rainChance).toBeCloseTo(0.3, 5);
    expect(race[1].rainChance).toBe(0);
    expect(race[2].rainChance).toBe(1);
  });

  it('clamps a rain chance outside 0..100', () => {
    const payload = weatherFixture();
    payload.RACE.START.WNV_RAIN_CHANCE.currentValue = 150;
    payload.RACE.NODE_25.WNV_RAIN_CHANCE.currentValue = -20;

    const { data } = apply('sessions-weather', payload);
    const race = data.session.forecast?.race ?? [];

    expect(race[0].rainChance).toBe(1);
    expect(race[1].rainChance).toBe(0);
  });

  it('keeps temperature and sky type as reported', () => {
    const { data } = apply('sessions-weather', weatherFixture());
    const race = data.session.forecast?.race ?? [];

    // The recorded race: clear at the start, clouding over, and cooling.
    expect(race.map((node) => node.skyType)).toEqual([0, 1, 1, 1, 2]);
    expect(race.map((node) => node.temperature)).toEqual([18, 17, 16, 16, 16]);
  });

  it('reads humidity as a fraction, and the wind as the sim states it', () => {
    const { data } = apply('sessions-weather', weatherFixture());
    const race = data.session.forecast?.race ?? [];

    // Per cent in the payload, like the rain chance.
    expect(race.map((node) => node.humidity)).toEqual([
      0.56, 0.6, 0.62, 0.54, 0.57,
    ]);
    // Metres per second: the sim words 17 as "61.2 kph".
    expect(race.map((node) => node.windSpeed)).toEqual([17, 17, 17, 14, 11]);
    // The sim's index, kept as one: it words 6 as "West", 7 as "North West".
    expect(race.map((node) => node.windDirection)).toEqual([6, 7, 7, 7, 7]);
    expect(data.session.forecast?.qualify?.[0]).toEqual({
      start: 0,
      skyType: 0,
      temperature: 23,
      rainChance: 0,
      humidity: 0.29,
      windSpeed: 22,
      windDirection: 6,
    });
  });

  it('still reads a point that states no humidity or wind', () => {
    // The five-or-nothing rule is tied to sky, temperature and rain chance.
    const payload = weatherFixture();
    const start = payload.RACE.START as Record<string, unknown>;
    delete start.WNV_HUMIDITY;
    delete start.WNV_WINDSPEED;
    delete start.WNV_WINDDIRECTION;

    const { data } = apply('sessions-weather', payload);
    const race = data.session.forecast?.race ?? [];

    expect(race).toHaveLength(5);
    expect(race[0]).toEqual({
      start: 0,
      skyType: 0,
      temperature: 18,
      rainChance: 0,
    });
    // The other points keep theirs.
    expect(race[1].humidity).toBe(0.6);
    expect(race[1].windSpeed).toBe(17);
  });

  it('leaves off a humidity or a wind it cannot read, and keeps the point', () => {
    const bent = (key: string, currentValue: unknown) => {
      const payload = weatherFixture();
      (payload.RACE.NODE_25 as Record<string, unknown>)[key] = { currentValue };
      const node = apply('sessions-weather', payload).data.session.forecast
        ?.race?.[1];
      expect(node?.temperature).toBe(17);
      return node;
    };

    ['62', null, NaN, {}].forEach((value) =>
      expect(bent('WNV_HUMIDITY', value)?.humidity).toBeUndefined()
    );
    ['fast', -3, Infinity].forEach((value) =>
      expect(bent('WNV_WINDSPEED', value)?.windSpeed).toBeUndefined()
    );
    // Eight directions, 0 to 7, and whole.
    [8, -1, 2.5, 'West'].forEach((value) =>
      expect(bent('WNV_WINDDIRECTION', value)?.windDirection).toBeUndefined()
    );
    expect(bent('WNV_WINDDIRECTION', 0)?.windDirection).toBe(0);
    expect(bent('WNV_WINDSPEED', 0)?.windSpeed).toBe(0);
  });

  it('clamps a humidity outside 0..100', () => {
    const payload = weatherFixture();
    payload.RACE.START.WNV_HUMIDITY.currentValue = 140;
    payload.RACE.NODE_25.WNV_HUMIDITY.currentValue = -5;

    const race =
      apply('sessions-weather', payload).data.session.forecast?.race ?? [];

    expect(race[0].humidity).toBe(1);
    expect(race[1].humidity).toBe(0);
  });

  it('asks again through the session, twice a minute at most', () => {
    // In case a forecast can change during a session. An unchanged body is
    // rejected unparsed, so the cost is a loopback request a minute.
    const task = taskById('sessions-weather');

    expect(task.mode).toBe('repeat');
    expect(task.baseIntervalMs).toBe(30_000);
    expect(task.maxIntervalMs).toBe(60_000);
  });

  it('recognises a forecast it already holds', () => {
    const { data } = apply('sessions-weather', weatherFixture());

    taskById('sessions-weather').outputs.forEach((output) => {
      expect(output.unchanged?.(data, output.parse(weatherFixture()))).toBe(
        true
      );
      // Nothing held yet is always news.
      expect(
        output.unchanged?.(createLmuRestData(), output.parse(weatherFixture()))
      ).toBe(false);
    });
  });

  it('sees any figure of any point changing, for that session type alone', () => {
    const { data } = apply('sessions-weather', weatherFixture());
    const race = outputById('sessions-weather', 'forecastRace');
    const practice = outputById('sessions-weather', 'forecastPractice');

    type Point = keyof ReturnType<typeof weatherFixture>['RACE'];
    const changes: [Point, string, number][] = [
      ['FINISH', 'WNV_SKY', 5],
      ['START', 'WNV_TEMPERATURE', 19],
      ['NODE_50', 'WNV_RAIN_CHANCE', 40],
      ['NODE_75', 'WNV_HUMIDITY', 70],
      ['NODE_25', 'WNV_WINDSPEED', 3],
      ['FINISH', 'WNV_WINDDIRECTION', 2],
    ];
    changes.forEach(([point, key, value]) => {
      const payload = weatherFixture();
      const node = payload.RACE[point] as Record<
        string,
        { currentValue: number }
      >;
      node[key].currentValue = value;

      expect(race.unchanged?.(data, race.parse(payload)), key).toBe(false);
      expect(practice.unchanged?.(data, practice.parse(payload))).toBe(true);
    });

    // A point that stops stating its wind is a change too.
    const quiet = weatherFixture();
    delete (quiet.RACE.START as Record<string, unknown>).WNV_WINDSPEED;
    expect(race.unchanged?.(data, race.parse(quiet))).toBe(false);
  });

  it('rejects a partial forecast rather than publishing a cliff', () => {
    // Four points rendered as five would read as a sudden change at the end.
    const payload = weatherFixture() as Record<string, unknown>;
    delete (payload.RACE as Record<string, unknown>).FINISH;

    const { data } = apply('sessions-weather', payload);

    expect(data.session.forecast?.race).toBeUndefined();
    // The other session types are independent and still land.
    expect(data.session.forecast?.practice).toHaveLength(5);
  });

  it('survives a garbage payload without throwing', () => {
    [{ RACE: 7 }, null, 'nope', {}].forEach((payload) => {
      expect(() => apply('sessions-weather', payload)).not.toThrow();
    });
  });
});

describe('car-setup-overview task', () => {
  it('reads the fuel ratio from the garage setup', () => {
    const { data } = apply('car-setup-overview', carSetupOverviewFixture());

    expect(data.session.fuelRatio).toBeCloseTo(1.03, 5);
  });

  it('reads the displayed number, not the slider index', () => {
    // VM_FUEL_LEVEL carries both: stringValue "1.03" is the ratio, value 102
    // is where the slider sits. Reading the latter would be wrong by ~100x.
    const { data } = apply('car-setup-overview', carSetupOverviewFixture());

    expect(data.session.fuelRatio).not.toBe(102);
    expect(data.session.fuelRatio).toBeLessThan(2);
  });

  it('relates virtual energy to litres, which is the point of it', () => {
    // As recorded: 45% at 1.03 L/% is 46.35 L, which the garage shows as
    // "46.4L" for fuel capacity.
    const { data } = apply('car-setup-overview', carSetupOverviewFixture());
    const ratio = data.session.fuelRatio ?? 0;

    expect(Math.abs(45 * ratio - 46.4)).toBeLessThan(0.1);
  });

  it('targets the session, since a setup value is not per-frame', () => {
    // All but the steering lock, which the telemetry mapper needs and so
    // travels as a cell.
    taskById('car-setup-overview')
      .outputs.filter((output) => output.id !== 'steerLockDeg')
      .forEach((output) => expect(output.target).toBe('session'));
  });

  it('repeats, because a setup can be edited mid-session', () => {
    // A one-shot would go stale the moment the player changed the slider.
    expect(
      LMU_REST_TASKS.find((t) => t.id === 'car-setup-overview')?.mode
    ).toBe('repeat');
  });

  it('applies nothing when the setup key is absent', () => {
    expect(
      apply('car-setup-overview', { carSetup: { garageValues: {} } }).applied
    ).toEqual([]);
  });

  it('ignores a non-numeric setup string', () => {
    const payload = {
      carSetup: {
        garageValues: { VM_FUEL_LEVEL: { stringValue: 'Non-adjustable' } },
      },
    };

    expect(apply('car-setup-overview', payload).applied).toEqual([]);
  });

  it('survives a garbage payload without throwing', () => {
    [
      { carSetup: 7 },
      null,
      'nope',
      {},
      { carSetup: { garageValues: 3 } },
    ].forEach((payload) => {
      expect(() => apply('car-setup-overview', payload)).not.toThrow();
    });
  });
});

describe('car-setup-overview fuel slider maximum', () => {
  it('reads maxValue, which is the LMGTE tank in litres', () => {
    const { data } = apply('car-setup-overview', carSetupOverviewFixture());

    expect(data.session.fuelLevelMax).toBe(120);
  });

  it('keeps it distinct from the ratio', () => {
    // Two numbers from one node, meaning different things: 1.03 L per percent
    // and a 120 L bound. Crossing them over is wrong by about a hundred times.
    const { data } = apply('car-setup-overview', carSetupOverviewFixture());

    expect(data.session.fuelRatio).toBeCloseTo(1.03, 5);
    expect(data.session.fuelLevelMax).toBe(120);
  });

  it('applies nothing when maxValue is absent', () => {
    const payload = {
      carSetup: { garageValues: { VM_FUEL_LEVEL: { stringValue: '0.83' } } },
    };

    const { data } = apply('car-setup-overview', payload);

    expect(data.session.fuelRatio).toBeCloseTo(0.83, 5);
    expect(data.session.fuelLevelMax).toBeUndefined();
  });

  it('compares both, since the overview moves on every poll', () => {
    // Its body carries the time of day beside the setup.
    const { data } = apply('car-setup-overview', carSetupOverviewFixture());
    const later = carSetupOverviewFixture();
    later.sessionTime.timeOfDay += 1;

    expect(apply('car-setup-overview', later, data).applied).toEqual([
      'steerLockDeg',
    ]);

    // An edit to the setup still lands.
    later.carSetup.garageValues.VM_FUEL_LEVEL.stringValue = '0.95';
    expect(apply('car-setup-overview', later, data).applied).toContain(
      'fuelRatio'
    );
    expect(data.session.fuelRatio).toBe(0.95);
  });
});

/** The setup overview with one garage value replaced, or removed. */
const setupWith = (key: string, value?: Record<string, unknown>) => {
  const payload = carSetupOverviewFixture();
  const others: [string, unknown][] = Object.entries(
    payload.carSetup.garageValues
  ).filter(([name]) => name !== key);
  return {
    ...payload,
    carSetup: {
      garageValues: Object.fromEntries(
        value === undefined ? others : [...others, [key, value]]
      ),
    },
  };
};

describe('car-setup-overview new brake discs', () => {
  const discs = (payload: unknown) =>
    apply('car-setup-overview', payload).data.session.brakeDiscNewMm;

  it('reads the thickness of a new disc on each wheel, in millimetres', () => {
    // "3.60 cm" front and "3.20 cm" rear, in the order LF, RF, LR, RR.
    expect(discs(carSetupOverviewFixture())).toEqual([36, 36, 32, 32]);
  });

  it('lands on the session: a setup value, which nothing reads per frame', () => {
    expect(outputById('car-setup-overview', 'brakeDiscNewMm').target).toBe(
      'session'
    );
  });

  it('converts the units a length can be worded in, exactly', () => {
    const worded = (stringValue: string) =>
      discs(setupWith('WM_BRAKEDISC-W_FL', { stringValue }))?.[0];

    expect(worded('3.60 cm')).toBe(36);
    expect(worded('3.25 cm')).toBe(32.5);
    expect(worded('2.85cm')).toBe(28.5);
    expect(worded('36.0 mm')).toBe(36);
    expect(worded('1.25 in')).toBe(31.75);
  });

  it('lands all four or none', () => {
    // Read by position, like every per-wheel list here.
    expect(discs(setupWith('WM_BRAKEDISC-W_RL'))).toBeUndefined();
  });

  it('rejects a thickness it cannot be sure of', () => {
    [
      { stringValue: '3.60' },
      { stringValue: '3.60 furlongs' },
      { stringValue: 'Carbon' },
      { stringValue: '0.00 cm' },
      { stringValue: 3.6 },
      { value: 0 },
      {},
    ].forEach((value) =>
      expect(discs(setupWith('WM_BRAKEDISC-W_FR', value))).toBeUndefined()
    );
  });

  it('recognises the discs it already holds, and a change of disc', () => {
    const output = outputById('car-setup-overview', 'brakeDiscNewMm');
    const { data } = apply('car-setup-overview', carSetupOverviewFixture());

    expect(
      output.unchanged?.(data, output.parse(carSetupOverviewFixture()))
    ).toBe(true);
    expect(
      output.unchanged?.(
        data,
        output.parse(setupWith('WM_BRAKEDISC-W_FL', { stringValue: '3.20 cm' }))
      )
    ).toBe(false);
    expect(
      output.unchanged?.(
        createLmuRestData(),
        output.parse(carSetupOverviewFixture())
      )
    ).toBe(false);
  });
});

describe('car-setup-overview steering lock', () => {
  const lock = (payload: unknown) =>
    apply('car-setup-overview', payload).data.cells.steerLockDeg?.value;

  it('reads the range of the wheel from the first number of the text', () => {
    // "476 (17.2) deg": the wheel's range, then the angle at the road
    // wheels. Not the bracket, and not the slider's position, 6.
    expect(lock(carSetupOverviewFixture())).toEqual([476]);
  });

  it('is a telemetry cell, because the telemetry mapper is what reads it', () => {
    expect(outputById('car-setup-overview', 'steerLockDeg').target).toBe(
      'telemetry'
    );
  });

  it('publishes nothing when the setting is absent', () => {
    expect(lock(setupWith('VM_STEER_LOCK'))).toBeUndefined();
  });

  it('publishes nothing for a text with no range in it', () => {
    [
      { stringValue: 'Non-adjustable' },
      { stringValue: '0 (0.0) deg' },
      { stringValue: 476 },
      { value: 6, maxValue: 7 },
    ].forEach((value) =>
      expect(lock(setupWith('VM_STEER_LOCK', value))).toBeUndefined()
    );
  });
});

describe('car-setup-overview regeneration level', () => {
  const output = () => outputById('car-setup-overview', 'regenLevel');
  /** Not recorded: the tape's car has no regeneration. */
  const withRegen = (stringValue = '3', value = 3) =>
    setupWith('VM_REGEN_LEVEL', { stringValue, value, maxValue: 6 });

  it('lands nothing for a car without the setting', () => {
    // The recorded LMGT3: the sim lists the setting with a single position.
    const { data, applied } = apply(
      'car-setup-overview',
      carSetupOverviewFixture()
    );

    expect(data.session.garage).toBeUndefined();
    expect(applied).not.toContain('regenLevel');
  });

  it('keeps the text, the position and the number of positions', () => {
    const { data } = apply('car-setup-overview', withRegen());

    expect(data.session.garage?.regenLevel).toEqual({
      text: '3',
      value: 3,
      positions: 6,
    });
    expect(output().target).toBe('session');
  });

  it('takes the level down once the car has none', () => {
    const { data } = apply('car-setup-overview', withRegen());

    apply('car-setup-overview', carSetupOverviewFixture(), data);

    // The whole group goes with its only member, so the session does not
    // carry an empty object.
    expect(data.session.garage).toBeUndefined();
  });

  it('keeps the level it holds through an answer it cannot read', () => {
    [
      undefined,
      { stringValue: '3', value: 3 },
      { stringValue: '3', value: 3, maxValue: '6' },
      { stringValue: 3, value: 3, maxValue: 6 },
      { stringValue: '3', maxValue: 6 },
    ].forEach((value) => {
      const { data } = apply('car-setup-overview', withRegen());

      apply('car-setup-overview', setupWith('VM_REGEN_LEVEL', value), data);

      expect(data.session.garage?.regenLevel?.positions).toBe(6);
    });
  });

  it('recognises what it holds, a change of level and the setting going', () => {
    const { data } = apply('car-setup-overview', withRegen());
    const none = output().parse(carSetupOverviewFixture());

    expect(output().unchanged?.(data, output().parse(withRegen()))).toBe(true);
    expect(output().unchanged?.(data, output().parse(withRegen('4', 4)))).toBe(
      false
    );
    expect(output().unchanged?.(data, none)).toBe(false);
    // Nothing held and nothing to hold: no republish.
    expect(output().unchanged?.(createLmuRestData(), none)).toBe(true);
    expect(
      output().unchanged?.(createLmuRestData(), output().parse(withRegen()))
    ).toBe(false);
  });

  it('replaces the group rather than writing into the one published', () => {
    const { data } = apply('car-setup-overview', withRegen());
    const published = data.session.garage;

    apply('car-setup-overview', withRegen('5', 5), data);

    expect(published?.regenLevel?.value).toBe(3);
    expect(data.session.garage?.regenLevel?.value).toBe(5);
  });
});

describe('pitstop-estimate penalty seconds', () => {
  it('reads the penalty time, which is the only thing naming the penalty', () => {
    // 0 with a drive-through outstanding, 10 with a stop-go. Observed live.
    const { data } = apply('pitstop-estimate', {
      ...pitstopEstimateFixture(),
      penalties: 10,
    });
    expect(data.cells.penaltySeconds?.value).toEqual([10]);
  });

  it('keeps a zero, which is what a drive-through looks like', () => {
    // Not treated as absent: zero seconds with a penalty outstanding is the
    // drive-through case, so it has to survive the parser.
    const { data, applied } = apply('pitstop-estimate', {
      ...pitstopEstimateFixture(),
      penalties: 0,
    });
    expect(applied).toContain('penaltySeconds');
    expect(data.cells.penaltySeconds?.value).toEqual([0]);
  });

  it('stays a telemetry cell, so it cannot force a session republish', () => {
    // The poller bumps the REST revision on every successful parse of a
    // session-targeted output, and this endpoint polls at 1 Hz -- which would
    // rebuild and rebroadcast the whole session snapshot every second.
    const output = taskById('pitstop-estimate').outputs.find(
      (o) => o.id === 'penaltySeconds'
    );
    expect(output?.target).toBe('telemetry');
  });

  it('applies nothing when the field is missing', () => {
    const { applied } = apply('pitstop-estimate', { total: 5 });
    expect(applied).not.toContain('penaltySeconds');
  });
});

describe('tire-management task', () => {
  it('reads the compounds in the order the sim indexes them', () => {
    const { data } = apply('tire-management', tireManagementFixture());
    expect(data.session.tireCompounds).toEqual([
      'Hard',
      'Medium',
      'Soft',
      'Wet',
    ]);
  });

  it('keeps a hole as a hole, so position stays the compound index', () => {
    // Filtering an unparseable entry out would renumber every compound after
    // it, and mislabel every car on one.
    const { data } = apply('tire-management', {
      optimalCompoundConditions: {
        compounds: [{ type: 'Hard' }, { notAType: 1 }, { type: 'Soft' }],
      },
    });
    expect(data.session.tireCompounds).toEqual(['Hard', '', 'Soft']);
  });

  it('targets the session, not telemetry', () => {
    // The catalogue reaches widgets through the session snapshot; a telemetry
    // target would rebuild the session on every poll.
    taskById('tire-management').outputs.forEach((output) =>
      expect(output.target).toBe('session')
    );
  });

  it('is fetched once per session, since a session cannot change it', () => {
    expect(taskById('tire-management').mode).toBe('once');
  });

  it('applies nothing for a payload it does not recognise', () => {
    expect(apply('tire-management', { other: 1 }).applied).toEqual([]);
    expect(
      apply('tire-management', {
        optimalCompoundConditions: { compounds: 'nope' },
      }).applied
    ).toEqual([]);
    // Every entry unparseable is the same as no catalogue: leave the previous
    // one alone rather than wiping it with a list of empty strings.
    expect(
      apply('tire-management', {
        optimalCompoundConditions: { compounds: [{}, {}] },
      }).applied
    ).toEqual([]);
  });
});

describe('multiplayer-teams task', () => {
  const output = () => {
    const found = taskById('multiplayer-teams').outputs.find(
      (candidate) => candidate.id === 'nationalities'
    );
    if (!found) throw new Error('no nationalities output');
    return found;
  };

  it('polls only in bursts the bridge starts, two seconds apart for sixteen', () => {
    const task = taskById(LMU_TEAMS_TASK_ID);
    expect(task.path).toBe('/rest/multiplayer/teams');
    expect(task.mode).toBe('burst');
    expect(task.baseIntervalMs).toBe(2000);
    expect(task.burstMs).toBe(16_000);
  });

  it('applies the flags it can read', () => {
    const { data } = apply('multiplayer-teams', {
      drivers: {
        'Jean Dupont': { nationality: 'FR' },
        'Ana Kosova': { nationality: 'XKX' },
      },
    });
    expect(data.session.nationalities).toEqual({ 'Jean Dupont': 'FR' });
  });

  it('reports each driver left without a flag, with what the sim sent', () => {
    const value = output().parse({
      drivers: {
        'Jean Dupont': { nationality: 'FR' },
        'Ana Kosova': { nationality: 'XKX' },
        'No Body': { nationality: '' },
      },
    });

    expect(output().report?.(value, undefined)).toBe(
      '[lmuRest] No country flag for "Ana Kosova" (XKX), "No Body" (empty); ' +
        '2 of 3 drivers have none'
    );
  });

  it('names only the drivers who were not already without a flag', () => {
    const before = output().parse({
      drivers: {
        'Jean Dupont': { nationality: 'FR' },
        'No Body': { nationality: '' },
      },
    });
    const after = output().parse({
      drivers: {
        'Jean Dupont': { nationality: 'FR' },
        'No Body': { nationality: '' },
        'New Comer': { nationality: '' },
      },
    });

    expect(output().report?.(before, before)).toBeUndefined();
    expect(output().report?.(after, before)).toBe(
      '[lmuRest] No country flag for "New Comer" (empty); ' +
        '2 of 3 drivers have none'
    );
  });

  it('does not count the admin entry of the server', () => {
    const value = output().parse({
      drivers: {
        'Jean Dupont': { nationality: 'FR' },
        Admin: { roles: ['Admin'], nationality: '' },
      },
    });
    expect(output().report?.(value, undefined)).toBeUndefined();
  });

  it('says nothing when every driver has a flag', () => {
    const value = output().parse({
      drivers: { 'Jean Dupont': { nationality: 'FR' } },
    });
    expect(output().report?.(value, undefined)).toBeUndefined();
  });

  it('republishes only when the flags themselves change', () => {
    // The body moves on every poll because isConnected flips; the flags do
    // not, and an unchanged set must not rebuild the session.
    const data = createLmuRestData();
    data.session.nationalities = { 'Jean Dupont': 'FR', 'Max Muster': 'DE' };
    const same = output().parse({
      drivers: {
        'Jean Dupont': { nationality: 'FR', isConnected: false },
        'Max Muster': { nationality: 'DE', isConnected: true },
      },
    });
    const gained = output().parse({
      drivers: {
        'Jean Dupont': { nationality: 'FR' },
        'Max Muster': { nationality: 'DE' },
        'New Comer': { nationality: 'IT' },
      },
    });
    const changed = output().parse({
      drivers: {
        'Jean Dupont': { nationality: 'BE' },
        'Max Muster': { nationality: 'DE' },
      },
    });

    expect(output().unchanged?.(data, same)).toBe(true);
    expect(output().unchanged?.(data, gained)).toBe(false);
    expect(output().unchanged?.(data, changed)).toBe(false);
    expect(output().unchanged?.(createLmuRestData(), same)).toBe(false);
  });

  it('still reports a payload with no flag at all, but keeps the old ones', () => {
    // Nothing to write, so the flags already held stay; the reason they are
    // not joined by these drivers' is still worth a line.
    const value = output().parse({
      drivers: { 'No Body': { nationality: '' } },
    });
    const data = createLmuRestData();
    data.session.nationalities = { 'Jean Dupont': 'FR' };

    expect(output().report?.(value, undefined)).toBe(
      '[lmuRest] No country flag for "No Body" (empty); 1 of 1 drivers have none'
    );
    expect(output().unchanged?.(data, value)).toBe(true);
  });
});

describe('game-state task', () => {
  const task = () => taskById('game-state');
  const stateOf = (payload: unknown) =>
    apply('game-state', payload).data.gameState;

  it('polls once a second, without backing off or giving up', () => {
    expect(task().path).toBe('/rest/sessions/GetGameState');
    expect(task().mode).toBe('repeat');
    expect(task().baseIntervalMs).toBe(1000);
    expect(task().maxIntervalMs).toBe(1000);
    expect(task().optional).toBe(true);
  });

  it('holds its last answer through two misses, not one', () => {
    // A single timeout behind another request on the one socket says nothing
    // about the player.
    expect(task().clearAfterFailures).toBe(3);
  });

  it('reads where the player is from MultiStintState', () => {
    expect(stateOf({ MultiStintState: 'DRIVING', inMonitor: false })).toBe(
      'driving'
    );
    expect(stateOf({ MultiStintState: 'PAUSED', inMonitor: false })).toBe(
      'paused'
    );
    expect(stateOf({ MultiStintState: 'MONITOR_MENU', inMonitor: true })).toBe(
      'monitor'
    );
    expect(
      stateOf({
        MultiStintState: 'END_OF_RACE_GRACE',
        gamePhase: 'GPHASE_CHECKERED',
        inMonitor: false,
      })
    ).toBe('driving');
  });

  it('reads the unavailable answer as out of any session', () => {
    expect(
      stateOf({
        status: 'unavailable',
        reason: 'Game is not in an active session',
        gameState: 'Setup',
      })
    ).toBe('notInSession');
  });

  it('reads a 404 as out of any game, and other failures as nothing', () => {
    const data = createLmuRestData();
    expect(task().answerFailure?.(data, { status: 404 })).toBe(true);
    expect(data.gameState).toBe('notInGame');

    const other = createLmuRestData();
    expect(task().answerFailure?.(other, { status: 500, body: '' })).toBe(
      false
    );
    expect(task().answerFailure?.(other, {})).toBe(false);
    expect(other.gameState).toBeUndefined();
  });

  it('forgets the state once the path stops answering', () => {
    const { data } = apply('game-state', { MultiStintState: 'DRIVING' });
    task().outputs.forEach((output) => output.clear?.(data));
    expect(data.gameState).toBeUndefined();
  });

  it('reports a MultiStintState it does not know, once, and reads no state', () => {
    const output = task().outputs[0];
    const value = output.parse({ MultiStintState: 'SPECTATING' });
    expect(stateOf({ MultiStintState: 'SPECTATING' })).toBeUndefined();
    expect(output.report?.(value, undefined)).toBe(
      '[lmuRest] Unrecognised GetGameState MultiStintState "SPECTATING"; ' +
        'reading in-car and in-session from shared memory'
    );
    expect(output.report?.(value, value)).toBeUndefined();
  });

  it('drops the last state for an answer of any other shape', () => {
    // A load screen answering something new must not leave the player in
    // the car for as long as it lasts.
    const data = createLmuRestData();
    data.gameState = 'driving';
    const output = task().outputs[0];
    output.apply(data, output.parse({ status: 'loading' }));
    expect(data.gameState).toBeUndefined();
  });

  it('knows the grace after the checkered flag, and does not report it', () => {
    const output = task().outputs[0];
    const value = output.parse({ MultiStintState: 'END_OF_RACE_GRACE' });
    expect(output.report?.(value, undefined)).toBeUndefined();
  });
});

describe('watch-focus task', () => {
  const focus = (payload: unknown) => {
    const { data, applied } = apply('watch-focus', payload);
    return { slot: data.cells.focusCarIdx?.value?.[0], applied };
  };

  it('reads the watched slot from the shape LMUTraceHUB names', () => {
    // `mID` is the scoring slot id, which is this app's CarIdx.
    expect(focus({ mID: 7 }).slot).toBe(7);
  });

  it('accepts the other spellings and a bare number', () => {
    // The shape is known from a string table, not a schema.
    expect(focus({ focusSlot: 3 }).slot).toBe(3);
    expect(focus({ slot: 3 }).slot).toBe(3);
    expect(focus({ id: 3 }).slot).toBe(3);
    expect(focus(3).slot).toBe(3);
    expect(focus({ mid: '3' }).slot).toBe(3);
  });

  it('keeps slot 0, which is a real car', () => {
    // A truthiness test here would drop the car in the first slot.
    expect(focus({ mID: 0 }).applied).toEqual(['focusCarIdx']);
    expect(focus({ mID: 0 }).slot).toBe(0);
  });

  it('takes -1 as a value, meaning nothing is focused', () => {
    // Not a parse failure: returning undefined would hold the last camera,
    // so leaving spectate would never hand the overlays back to the player.
    expect(focus({ mID: -1 }).applied).toEqual(['focusCarIdx']);
    expect(focus({ mID: -1 }).slot).toBe(-1);
  });

  it('leaves the previous value alone for anything it cannot read', () => {
    // The contract every parser here follows. A hiccup must not drop the
    // camera back to the player's empty slot mid-lap.
    for (const payload of [
      {},
      null,
      undefined,
      'focus',
      { mID: 'abc' },
      { mID: 1.5 },
      { mID: -2 },
      { mID: 104 },
      { mID: Number.NaN },
      { somethingElse: 3 },
    ]) {
      expect(focus(payload).applied).toEqual([]);
    }
  });

  it('polls often, because the camera moves on a keypress', () => {
    const task = taskById('watch-focus');
    expect(task.mode).toBe('repeat');
    expect(task.baseIntervalMs).toBeLessThanOrEqual(500);
  });

  it('lands in telemetry, so moving the camera is not a session rebuild', () => {
    expect(
      taskById('watch-focus').outputs.every((o) => o.target === 'telemetry')
    ).toBe(true);
  });
});

describe('watch-standings task', () => {
  const teams = (payload: unknown) => {
    const { data, applied } = apply('watch-standings', payload);
    return { names: data.session.teamNames, applied };
  };

  it('takes the team name the endpoint states, not the entry name', () => {
    // The whole reason this endpoint is polled: the entry name carries the
    // season, so parsing its prefix gives "Proton Competition 2026".
    expect(teams(watchStandingsFixture()).names).toEqual({
      5: 'Proton Competition',
      8: 'Vista AF Corse',
    });
  });

  it('keys by slotID, which is CarIdx', () => {
    // Confirmed by the spectator camera: /rest/watch/focus answers with a
    // slotID, and publishing it as CamCarIdx lands on the right car.
    expect(teams([{ slotID: 0, fullTeamName: ' Proton  ' }]).names).toEqual({
      0: 'Proton',
    });
  });

  it('skips an entry with no usable slot or team', () => {
    expect(
      teams([
        { slotID: 1 },
        { fullTeamName: 'B' },
        { slotID: 2, fullTeamName: '   ' },
        { slotID: -1, fullTeamName: 'C' },
        { slotID: 104, fullTeamName: 'D' },
        { slotID: 1.5, fullTeamName: 'E' },
        { slotID: '3', fullTeamName: 'F' },
        { slotID: 7, fullTeamName: 'G' },
      ]).names
    ).toEqual({ 7: 'G' });
  });

  it('survives a driver swap without a repoll', () => {
    // The point of keying by slot: a team runs a car, and the driver in it
    // changes at every stop of an endurance race. A name key would go stale
    // on each swap until the next poll.
    const out = output();
    const data = createLmuRestData();
    out.apply(data, out.parse(watchStandingsFixture()));

    const swapped = watchStandingsFixture();
    swapped[1].driverName = 'Someone Else';
    expect(out.unchanged?.(data, out.parse(swapped))).toBe(true);
    expect(data.session.teamNames?.[8]).toBe('Vista AF Corse');
  });

  it('leaves the previous answer alone for anything it cannot read', () => {
    // A build whose payload this does not recognise must not clear every
    // team name on the grid.
    for (const payload of [null, undefined, {}, [], 'standings', [1, 2, 3]]) {
      expect(teams(payload).applied).toEqual([]);
    }
  });

  const output = () => taskById('watch-standings').outputs[0];

  it('recognises the names it already holds', () => {
    // The body carries live positions, so it differs on every poll. A session
    // target that claimed a change each time would rebuild the whole snapshot
    // and broadcast it every ten seconds.
    const out = output();
    const data = createLmuRestData();

    const first = out.parse(watchStandingsFixture());
    expect(out.unchanged?.(data, first)).toBe(false);
    out.apply(data, first);

    expect(out.unchanged?.(data, out.parse(watchStandingsFixture()))).toBe(
      true
    );
  });

  it('sees a team being renamed as a change', () => {
    const out = output();
    const data = createLmuRestData();
    out.apply(data, out.parse(watchStandingsFixture()));

    const renamed = watchStandingsFixture();
    renamed[0].fullTeamName = 'Proton Racing';
    expect(out.unchanged?.(data, out.parse(renamed))).toBe(false);
  });

  it('sees a car joining as a change', () => {
    // The case a key-by-key comparison alone would miss, and the one that
    // matters: every slot already held still matches, so only the count says
    // a car has appeared. Without that, a mid-session joiner would never get
    // a team name.
    const out = output();
    const data = createLmuRestData();
    out.apply(data, out.parse(watchStandingsFixture()));

    const joined = [
      ...watchStandingsFixture(),
      { slotID: 11, driverName: 'Late Arrival', fullTeamName: 'Iron Lynx' },
    ];
    const parsed = out.parse(joined);
    expect(out.unchanged?.(data, parsed)).toBe(false);

    out.apply(data, parsed);
    expect(data.session.teamNames?.[11]).toBe('Iron Lynx');
  });

  it('sees a car leaving as a change', () => {
    const out = output();
    const data = createLmuRestData();
    out.apply(data, out.parse(watchStandingsFixture()));

    const shorter = watchStandingsFixture().slice(0, 1);
    expect(out.unchanged?.(data, out.parse(shorter))).toBe(false);
  });

  it('polls slowly, because the body moves every time', () => {
    // The hash compare cannot help here, so every poll pays for a JSON.parse
    // of the whole field. How often is the only lever.
    expect(taskById('watch-standings').baseIntervalMs).toBeGreaterThanOrEqual(
      5000
    );
  });

  it('is optional, so it keeps probing until a session is live', () => {
    expect(taskById('watch-standings').optional).toBe(true);
  });
});
