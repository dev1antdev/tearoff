import { describe, expect, it } from 'vitest';
import {
  createView,
  headingRotation,
  insideDisc,
  labelFontSize,
  markerLabel,
  project,
  textColorOn,
  updateView,
} from './minimapModel';

/** A view centred on (100, 100): 200 px disc, 100 m range, 1 unit per metre. */
const view = (rotation = 0) =>
  updateView(createView(), { x: 100, y: 100 }, rotation, 100, 100, 1, 150, 150);

describe('project', () => {
  it('puts the focus car at the centre of the canvas', () => {
    const point = project(view(), 100, 100, { x: 0, y: 0 });

    expect(point).toEqual({ x: 150, y: 150 });
  });

  it('scales metres to pixels so the range reaches the edge', () => {
    // 100 m to the right of the car is the edge of a 100 m map.
    const point = project(view(), 200, 100, { x: 0, y: 0 });

    expect(point.x).toBeCloseTo(250);
    expect(point.y).toBeCloseTo(150);
  });

  it('accounts for drawings that are not one unit per metre', () => {
    const scaled = updateView(
      createView(),
      { x: 0, y: 0 },
      0,
      100,
      100,
      // Half a drawing unit per metre: 50 units is the full 100 m.
      0.5,
      150,
      150
    );

    expect(project(scaled, 50, 0, { x: 0, y: 0 }).x).toBeCloseTo(250);
  });
});

describe('headingRotation', () => {
  it('leaves a car already pointing up alone', () => {
    expect(headingRotation(0, -1)).toBeCloseTo(0);
  });

  it('turns the map so the road ahead points to the top', () => {
    // The car is heading right; a point 50 m ahead of it must land above the
    // centre once the map is turned.
    const rotated = view(headingRotation(1, 0));
    const ahead = project(rotated, 150, 100, { x: 0, y: 0 });

    expect(ahead.x).toBeCloseTo(150);
    expect(ahead.y).toBeCloseTo(100);
  });

  it('keeps left on the left when heading down the drawing', () => {
    // Heading down the drawing (0, 1), the car's left is the drawing's +x.
    // Turned heading-up, that point has to land left of centre: a mirrored
    // map would put it on the right.
    const rotated = view(headingRotation(0, 1));
    const left = project(rotated, 150, 100, { x: 0, y: 0 });

    expect(left.x).toBeCloseTo(100);
    expect(left.y).toBeCloseTo(150);
  });
});

describe('insideDisc', () => {
  it('keeps a marker that still overlaps the edge', () => {
    const current = view();

    expect(insideDisc(current, { x: 255, y: 150 }, 100, 10)).toBe(true);
    expect(insideDisc(current, { x: 265, y: 150 }, 100, 10)).toBe(false);
  });
});

describe('markerLabel', () => {
  const source = { position: 7, classPosition: 2, carNumber: '51' };

  it('writes the figure the setting asks for', () => {
    expect(markerLabel('position', source)).toBe('7');
    expect(markerLabel('classPosition', source)).toBe('2');
    expect(markerLabel('carNumber', source)).toBe('51');
    expect(markerLabel('none', source)).toBe('');
  });

  it('writes nothing for a car the sim has not ranked yet', () => {
    // Both sims report 0 before a car has a position; a marker reading "0"
    // would look like a real place.
    expect(markerLabel('position', { ...source, position: 0 })).toBe('');
    expect(
      markerLabel('classPosition', { ...source, classPosition: undefined })
    ).toBe('');
  });
});

describe('textColorOn', () => {
  it('picks dark text on a light marker and light text on a dark one', () => {
    expect(textColorOn('#ffffff')).toBe('#0f172a');
    expect(textColorOn('#facc15')).toBe('#0f172a');
    expect(textColorOn('#1e3a8a')).toBe('#ffffff');
  });

  it('falls back to dark text for a colour it cannot read', () => {
    expect(textColorOn('red')).toBe('#0f172a');
  });
});

describe('labelFontSize', () => {
  it('shrinks the text as the label gets longer', () => {
    expect(labelFontSize(10, '7')).toBeCloseTo(10.5);
    expect(labelFontSize(10, '12')).toBeCloseTo(10.5);
    expect(labelFontSize(10, '123')).toBeCloseTo(7);
  });
});
