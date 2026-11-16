import { describe, expect, it } from 'vitest';
import {
  learnedSectorStarts,
  sectorLapSpans,
  sectorsFromStarts,
} from './trackSectors';

/** Laguna Seca, as the recorded lap placed its sectors. */
const LAGUNA = [0, 0.39, 0.792];

describe('learnedSectorStarts', () => {
  it('gives the starts the car was seen crossing', () => {
    expect(
      learnedSectorStarts({ sectorStartPct: LAGUNA, sectorSource: 'learned' })
    ).toEqual(LAGUNA);
  });

  it('gives nothing while the session only has its even thirds', () => {
    // Not enough crossings yet: no clean lap has been driven here, so the
    // thirds are a placeholder and nothing is drawn from them.
    expect(
      learnedSectorStarts({
        sectorStartPct: [0, 1 / 3, 2 / 3],
        sectorSource: 'nominal',
      })
    ).toBeNull();
  });

  it("gives nothing for a session's own starts: they are not learned ones", () => {
    // Under iRacing the map reads the session itself, not this.
    expect(
      learnedSectorStarts({
        sectorStartPct: [0, 0.25, 0.5, 0.75],
        sectorSource: 'session',
      })
    ).toBeNull();
  });

  it('gives nothing before the channel has published', () => {
    expect(learnedSectorStarts(undefined)).toBeNull();
    expect(learnedSectorStarts(null)).toBeNull();
  });

  it('refuses starts that are not a lap in order', () => {
    const learned = (sectorStartPct: number[]) =>
      learnedSectorStarts({ sectorStartPct, sectorSource: 'learned' });

    expect(learned([])).toBeNull();
    // Not from the line.
    expect(learned([0.1, 0.4, 0.8])).toBeNull();
    // Out of order, twice the same, and past the end of the lap.
    expect(learned([0, 0.8, 0.4])).toBeNull();
    expect(learned([0, 0.4, 0.4])).toBeNull();
    expect(learned([0, 0.4, 1])).toBeNull();
    expect(learned([0, 0.4, Number.NaN])).toBeNull();
  });
});

describe('sectorsFromStarts', () => {
  it('numbers the sectors from the line', () => {
    expect(sectorsFromStarts(LAGUNA)).toEqual([
      { SectorNum: 0, SectorStartPct: 0 },
      { SectorNum: 1, SectorStartPct: 0.39 },
      { SectorNum: 2, SectorStartPct: 0.792 },
    ]);
  });
});

describe('sectorLapSpans', () => {
  it('gives the stretch of the one sector that is marked', () => {
    expect(sectorLapSpans(LAGUNA, [false, true, false])).toEqual([
      { from: 0.39, to: 0.792 },
    ]);
  });

  it('runs the last sector to the line', () => {
    expect(sectorLapSpans(LAGUNA, [false, false, true])).toEqual([
      { from: 0.792, to: 1 },
    ]);
  });

  it('joins sectors that are next to each other', () => {
    expect(sectorLapSpans(LAGUNA, [true, true, false])).toEqual([
      { from: 0, to: 0.792 },
    ]);
    expect(sectorLapSpans(LAGUNA, [true, true, true])).toEqual([
      { from: 0, to: 1 },
    ]);
  });

  it('keeps the last and the first apart: they meet at the line', () => {
    expect(sectorLapSpans(LAGUNA, [true, false, true])).toEqual([
      { from: 0, to: 0.39 },
      { from: 0.792, to: 1 },
    ]);
  });

  it('gives nothing when no sector is marked, or the sim marks none', () => {
    expect(sectorLapSpans(LAGUNA, [false, false, false])).toEqual([]);
    // iRacing flags no sectors: the list is empty.
    expect(sectorLapSpans(LAGUNA, [])).toEqual([]);
  });

  it('hands back one empty list, so an unchanged map is not redrawn', () => {
    expect(sectorLapSpans(LAGUNA, [])).toBe(
      sectorLapSpans(LAGUNA, [false, false, false])
    );
  });

  it('gives nothing for starts that are not a lap in order', () => {
    expect(sectorLapSpans([], [true])).toEqual([]);
    expect(sectorLapSpans([0, 0.8, 0.4], [true, true, true])).toEqual([]);
  });

  it('ignores a mark for a sector that does not exist', () => {
    expect(sectorLapSpans(LAGUNA, [false, false, false, true])).toEqual([]);
  });
});
