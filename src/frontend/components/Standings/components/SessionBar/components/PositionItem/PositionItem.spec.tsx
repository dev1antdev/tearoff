import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionItem } from './PositionItem';

const scene = vi.hoisted(() => ({
  focus: undefined as
    | {
        carIdx: number;
        position: number;
        classPosition: number;
        sessionNum: number | null;
      }
    | undefined,
  fieldSize: 0,
}));

vi.mock('@irdashies/domain', () => ({
  useFocusCarPlace: () => scene.focus,
  useFieldSize: () => scene.fieldSize,
}));

const item = () =>
  render(<PositionItem settings={undefined} standalone={false} />).container;

describe('PositionItem', () => {
  beforeEach(() => {
    scene.focus = { carIdx: 0, position: 26, classPosition: 2, sessionNum: 0 };
    scene.fieldSize = 38;
  });

  it('prints the place against the field', () => {
    const container = item();

    expect(container.textContent).toBe('P26/38');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('is not rendered for a car with no place', () => {
    scene.focus = { carIdx: 0, position: 0, classPosition: 0, sessionNum: 0 };

    expect(item()).toBeEmptyDOMElement();
  });

  it('is not rendered for a car that is not one of the cars racing', () => {
    // The pace car, a spectator: the field it would be out of is nothing.
    scene.fieldSize = 0;

    expect(item()).toBeEmptyDOMElement();
  });

  it('is not rendered before the first standings snapshot', () => {
    scene.focus = undefined;

    expect(item()).toBeEmptyDOMElement();
  });
});
