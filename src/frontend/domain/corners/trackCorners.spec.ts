import { describe, expect, it } from 'vitest';
import type { LovelyTrackSection } from '@irdashies/types';
import { trackCornersFrom } from './trackCorners';

const section = (
  overrides: Partial<LovelyTrackSection> = {}
): LovelyTrackSection =>
  ({
    section_id: 'turn-1',
    name: 'Turn 1',
    corner_number: 'T1',
    type: 'corner',
    start_pct: 0.2,
    end_pct: 0.25,
    length_pct: 0.05,
    ...overrides,
  }) as LovelyTrackSection;

describe('trackCornersFrom', () => {
  it('lists the corners in lap order and leaves the straights out', () => {
    const corners = trackCornersFrom(
      [
        section({ section_id: 'b', name: 'Turn 2', corner_number: 'T2' }),
        section({
          section_id: 'main-straight',
          name: 'Main Straight',
          corner_number: undefined,
          type: 'straight',
          start_pct: 0.9,
          end_pct: 0.05,
        }),
        section({ section_id: 'a', start_pct: 0.05, end_pct: 0.1 }),
      ],
      'name'
    );

    expect(corners.map((corner) => corner.section_id)).toEqual(['a', 'b']);
  });

  it('drops a section that starts before the one kept ahead of it ends', () => {
    const corners = trackCornersFrom(
      [
        section({ section_id: 'first', start_pct: 0.2, end_pct: 0.25 }),
        section({
          section_id: 'overlapping',
          name: 'Turn 2',
          corner_number: 'T2',
          start_pct: 0.249,
          end_pct: 0.3,
        }),
        section({
          section_id: 'next',
          name: 'Turn 3',
          corner_number: 'T3',
          start_pct: 0.3,
          end_pct: 0.35,
        }),
      ],
      'name'
    );

    expect(corners.map((corner) => corner.section_id)).toEqual([
      'first',
      'next',
    ]);
  });

  it('labels a corner by its turn number where it has one, else its name', () => {
    const corners = trackCornersFrom(
      [
        section(),
        section({
          section_id: 'eau-rouge',
          name: 'Eau Rouge',
          corner_number: undefined,
          start_pct: 0.3,
          end_pct: 0.35,
        }),
      ],
      'name'
    );

    expect(corners.map((corner) => corner.label)).toEqual(['T1', 'Eau Rouge']);
  });

  it('counts the corners off where the track numbers only some of them', () => {
    const corners = trackCornersFrom(
      [
        section(),
        section({
          section_id: 'eau-rouge',
          name: 'Eau Rouge',
          corner_number: undefined,
          start_pct: 0.3,
          end_pct: 0.35,
        }),
      ],
      'number'
    );

    expect(corners.map((corner) => corner.label)).toEqual(['T1', 'T2']);
  });

  it('tells the halves of one complex apart, in the label and in the id', () => {
    const halves = [
      section({
        section_id: 'acque-minerali',
        name: 'Acque Minerali',
        corner_number: undefined,
        start_pct: 0.54,
        end_pct: 0.575,
      }),
      section({
        section_id: 'acque-minerali',
        name: 'Acque Minerali',
        corner_number: undefined,
        start_pct: 0.575,
        end_pct: 0.598,
      }),
    ];

    const named = trackCornersFrom(halves, 'name');
    expect(named.map((corner) => corner.label)).toEqual([
      'Acque Minerali A',
      'Acque Minerali B',
    ]);
    expect(named.map((corner) => corner.section_id)).toEqual([
      'acque-minerali_a',
      'acque-minerali_b',
    ]);

    // The id is a row's identity and does not follow the label style.
    const numbered = trackCornersFrom(halves, 'number');
    expect(numbered.map((corner) => corner.label)).toEqual(['T1A', 'T1B']);
    expect(numbered.map((corner) => corner.section_id)).toEqual(
      named.map((corner) => corner.section_id)
    );
  });

  it('keeps a corner across the line, and what follows it', () => {
    const corners = trackCornersFrom(
      [
        section({ section_id: 'first', start_pct: 0.02, end_pct: 0.06 }),
        section({
          section_id: 'last',
          name: 'Turn 9',
          corner_number: 'T9',
          start_pct: 0.98,
          end_pct: 0.01,
        }),
      ],
      'name'
    );

    expect(corners.map((corner) => corner.section_id)).toEqual([
      'first',
      'last',
    ]);
  });
});
