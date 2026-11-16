import { describe, expect, it } from 'vitest';
import { carChoices, chosenCar } from './carChoice';

const driver = (
  CarIdx: number,
  CarNumber: string,
  CarClassID: number,
  values: Record<string, unknown> = {}
) => ({
  CarIdx,
  CarNumber,
  CarNumberRaw: Number(CarNumber),
  UserName: `Driver ${CarNumber}`,
  TeamName: `Team ${CarNumber}`,
  CarClassID,
  CarClassShortName: CarClassID === 1 ? 'Hypercar' : 'LMGT3',
  CarIsPaceCar: 0,
  IsSpectator: 0,
  ...values,
});

/** Two Hypercars and four LMGT3, ours the #77 in slot 4. */
const DRIVERS = [
  driver(0, '7', 1),
  driver(1, '50', 1),
  driver(2, '33', 2),
  driver(3, '46', 2),
  driver(4, '77', 2),
  driver(5, '91', 2),
];
// Places by slot: the Hypercars lead, ours is third of the LMGT3.
const POSITIONS = [2, 1, 4, 3, 5, 6];
const CLASS_POSITIONS = [2, 1, 2, 1, 3, 4];

const numbers = (choices: readonly { number: string }[]): string[] =>
  choices.map((choice) => choice.number);

describe('carChoices', () => {
  it('offers our car first, then our class by place, then the rest by place', () => {
    const choices = carChoices(DRIVERS, 4, POSITIONS, CLASS_POSITIONS);
    expect(numbers(choices)).toEqual(['77', '46', '33', '91', '50', '7']);
    expect(choices.map((choice) => choice.group)).toEqual([
      'own',
      'class',
      'class',
      'class',
      'rest',
      'rest',
    ]);
  });

  it('names each car by its team, and says its class', () => {
    const [own] = carChoices(DRIVERS, 4, POSITIONS, CLASS_POSITIONS);
    expect(own).toEqual({
      carIdx: 4,
      number: '77',
      name: 'Team 77',
      className: 'LMGT3',
      group: 'own',
    });
  });

  it('names a car with no team by its driver', () => {
    const [own] = carChoices(
      [driver(4, '77', 2, { TeamName: '' })],
      4,
      undefined,
      undefined
    );
    expect(own.name).toBe('Driver 77');
  });

  it('puts a car the sim has not placed after those it has, by number', () => {
    // Before the start nobody has a place: the class goes by number.
    const unplaced = carChoices(DRIVERS, 4, [], []);
    expect(numbers(unplaced)).toEqual(['77', '33', '46', '91', '7', '50']);
    // One car without a place among cars with one.
    const one = carChoices(DRIVERS, 4, POSITIONS, [2, 1, 0, 1, 3, 4]);
    expect(numbers(one).slice(0, 4)).toEqual(['77', '46', '91', '33']);
  });

  it('leaves out the pace car and spectators', () => {
    const choices = carChoices(
      [
        ...DRIVERS,
        driver(6, '0', 3, { CarIsPaceCar: 1 }),
        driver(7, '99', 2, { IsSpectator: 1 }),
      ],
      4,
      POSITIONS,
      CLASS_POSITIONS
    );
    expect(numbers(choices)).not.toContain('0');
    expect(numbers(choices)).not.toContain('99');
  });

  it('lists the whole field by place where we have no car in it', () => {
    const choices = carChoices(DRIVERS, undefined, POSITIONS, CLASS_POSITIONS);
    expect(numbers(choices)).toEqual(['50', '7', '46', '33', '77', '91']);
    expect(choices.every((choice) => choice.group === 'rest')).toBe(true);
  });

  it('is empty without a session', () => {
    expect(carChoices(undefined, 4, POSITIONS, CLASS_POSITIONS)).toEqual([]);
  });
});

describe('chosenCar', () => {
  const choices = carChoices(DRIVERS, 4, POSITIONS, CLASS_POSITIONS);

  it('is our own until another is chosen', () => {
    expect(chosenCar(choices, null)?.number).toBe('77');
  });

  it('is the car chosen', () => {
    expect(chosenCar(choices, 2)?.number).toBe('33');
  });

  it('is our own again once the car chosen has left the session', () => {
    expect(chosenCar(choices, 42)?.number).toBe('77');
  });

  it('is nobody with no car at all', () => {
    expect(chosenCar([], null)).toBeNull();
  });
});
