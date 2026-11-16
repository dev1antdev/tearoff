import { describe, expect, it } from 'vitest';
import type { Standings } from '@irdashies/domain';
import {
  ALL_TAB,
  resolveTowerTab,
  towerTabs,
  towerTag,
  type TowerClassName,
} from './towerRows';

/** A row with only what the tabs read of it. */
const car = (classId: number, name: string) =>
  ({
    carIdx: 0,
    carClass: { id: classId, name, color: classId * 100 },
  }) as unknown as Standings;

const CLASSES: [string, Standings[]][] = [
  ['10', [car(10, 'Hypercar'), car(10, 'Hypercar')]],
  ['20', [car(20, 'LMP2')]],
  ['30', [car(30, 'LMGT3'), car(30, 'LMGT3'), car(30, 'LMGT3')]],
];

const NAMES: Record<string, TowerClassName> = {
  '10': { shortName: 'Hypercar', color: 0xff000a },
  '20': { shortName: 'LMP2', color: 0x0690ff },
  '30': { shortName: 'LMGT3', color: 0x00ff6a },
};

describe('towerTabs', () => {
  it('has a tab for each class, in the order given, and one for all', () => {
    expect(towerTabs(CLASSES, NAMES)).toEqual([
      { id: '10', label: 'Hypercar', color: 0xff000a },
      { id: '20', label: 'LMP2', color: 0x0690ff },
      { id: '30', label: 'LMGT3', color: 0x00ff6a },
      { id: ALL_TAB, label: 'All' },
    ]);
  });

  it('has none in a session of one class', () => {
    expect(towerTabs([CLASSES[2]], NAMES)).toEqual([]);
    expect(towerTabs([], NAMES)).toEqual([]);
  });

  it('gives a class with no car in it no tab', () => {
    const emptied: [string, Standings[]][] = [
      CLASSES[0],
      ['20', []],
      CLASSES[2],
    ];

    expect(towerTabs(emptied, NAMES).map((tab) => tab.id)).toEqual([
      '10',
      '30',
      ALL_TAB,
    ]);
    // Two classes, one of them empty: nothing to choose between.
    expect(towerTabs([CLASSES[0], ['20', []]], NAMES)).toEqual([]);
  });

  it('names a class from its cars where the session has no name for it', () => {
    expect(towerTabs(CLASSES, undefined).map((tab) => tab.label)).toEqual([
      'Hypercar',
      'LMP2',
      'LMGT3',
      'All',
    ]);
    expect(towerTabs(CLASSES, undefined)[1].color).toBe(2000);
  });
});

describe('resolveTowerTab', () => {
  const tabs = towerTabs(CLASSES, NAMES);

  it('opens on the class of our own car', () => {
    expect(resolveTowerTab(null, tabs, '30', CLASSES)).toBe('30');
    expect(resolveTowerTab(null, tabs, '10', CLASSES)).toBe('10');
  });

  it('opens on the first class while our own is not known', () => {
    expect(resolveTowerTab(null, tabs, undefined, CLASSES)).toBe('10');
    // A class the session no longer has.
    expect(resolveTowerTab(null, tabs, '77', CLASSES)).toBe('10');
  });

  it('stays on the tab that was chosen', () => {
    expect(resolveTowerTab('20', tabs, '30', CLASSES)).toBe('20');
    expect(resolveTowerTab(ALL_TAB, tabs, '30', CLASSES)).toBe(ALL_TAB);
  });

  it('goes back to our own class when the chosen one is gone', () => {
    expect(resolveTowerTab('55', tabs, '30', CLASSES)).toBe('30');
  });

  it('is the one class there is where there are no tabs, whatever was chosen', () => {
    const single = [CLASSES[2]];
    const none = towerTabs(single, NAMES);

    expect(resolveTowerTab(null, none, '30', single)).toBe('30');
    expect(resolveTowerTab(ALL_TAB, none, '30', single)).toBe('30');
    expect(resolveTowerTab('10', none, undefined, single)).toBe('30');
  });

  it('is the whole field where there is no car at all', () => {
    expect(resolveTowerTab(null, [], undefined, [])).toBe(ALL_TAB);
  });
});

describe('towerTag', () => {
  /** A car out on the circuit that has never been in the pit lane. */
  const running = {
    finishState: undefined,
    dnf: false,
    onTrack: true,
    onPitRoad: false,
    lastPitLap: undefined,
    lastLap: 12,
    carTrackSurface: 3,
  } as const;

  it('says nothing of a car out on the circuit', () => {
    expect(towerTag(running, false, false)).toBeNull();
  });

  it('says PIT while the car is in the pit lane', () => {
    expect(
      towerTag({ ...running, onPitRoad: true, lastPitLap: 12 }, false, false)
    ).toBe('PIT');
  });

  it('says OUT on the lap the car left the pit lane on, and no longer', () => {
    expect(towerTag({ ...running, lastPitLap: 12 }, false, false)).toBe('OUT');
    expect(
      towerTag({ ...running, lastPitLap: 12, lastLap: 13 }, false, false)
    ).toBeNull();
    // A lap longer where the pit exit is just before the line.
    expect(
      towerTag({ ...running, lastPitLap: 12, lastLap: 13 }, false, true)
    ).toBe('OUT');
  });

  it('says GAR for a car the sim says is in its garage, pit road or not', () => {
    expect(towerTag({ ...running, onPitRoad: true }, true, false)).toBe('GAR');
    expect(towerTag(running, true, false)).toBe('GAR');
  });

  it('says AWAY for a car that is not in the world', () => {
    expect(
      towerTag(
        { ...running, onTrack: false, carTrackSurface: -1 },
        false,
        false
      )
    ).toBe('AWAY');
  });

  it('says DNF and DQ before anything else', () => {
    expect(
      towerTag({ ...running, finishState: 'DNF', onPitRoad: true }, true, false)
    ).toBe('DNF');
    expect(
      towerTag({ ...running, finishState: 'DQ', onTrack: false }, false, false)
    ).toBe('DQ');
    // iRacing's flag for a car that is out.
    expect(towerTag({ ...running, dnf: true }, false, false)).toBe('DNF');
  });

  it('says nothing of a car that has finished', () => {
    expect(
      towerTag({ ...running, finishState: 'FINISHED' }, false, false)
    ).toBeNull();
  });
});
