import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type ClassFieldsConfig,
} from '@irdashies/types';
import type { ClassField } from '@irdashies/domain/standings/classFields';
import { ClassFields } from './ClassFields';

const field = (
  name: string,
  overrides: Partial<ClassField> = {}
): ClassField => ({
  classId: name.length,
  name,
  color: 0x0690ff,
  total: 14,
  active: 14,
  inPitLane: 0,
  leaderPosition: 1,
  isFocusClass: false,
  ...overrides,
});

const scene = vi.hoisted(() => ({
  isDriving: true,
  isWatching: false,
  isSessionVisible: true,
  numCarClasses: 3,
  config: {} as Record<string, unknown>,
  fields: [] as unknown[],
  /** The arguments the widget last asked the summary with. */
  asked: [] as unknown[],
}));

vi.mock('@irdashies/context', () => ({
  useDrivingState: () => ({
    isDriving: scene.isDriving,
    isWatching: scene.isWatching,
  }),
  useSessionVisibility: () => scene.isSessionVisible,
  useWeekendInfoNumCarClasses: () => scene.numCarClasses,
}));

vi.mock('@irdashies/domain/standings/useHighlightColor', () => ({
  useHighlightColor: () => 960745,
}));

vi.mock('@irdashies/domain/standings/classFields', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@irdashies/domain/standings/classFields')
  >()),
  useClassFields: (...args: unknown[]) => {
    scene.asked = args;
    return scene.fields;
  },
}));

vi.mock('./hooks/useClassFieldsSettings', () => ({
  useClassFieldsSettings: () => scene.config,
}));

const threeClasses = (): ClassField[] => [
  field('LMP2', { leaderPosition: 1 }),
  field('LMP3', { total: 10, active: 10, leaderPosition: 15, color: 0x763993 }),
  field('LMGT3', { leaderPosition: 25, color: 0x00ff6a, isFocusClass: true }),
];

const configure = (overrides: Partial<ClassFieldsConfig> = {}) => {
  scene.config = {
    ...getWidgetDefaultConfig('classfields'),
    ...overrides,
  } as unknown as Record<string, unknown>;
};

const chips = () => screen.queryAllByTestId('class-field');
const chip = (name: string) =>
  chips().find((element) => element.dataset.class === name) as HTMLElement;

beforeEach(() => {
  scene.isDriving = true;
  scene.isWatching = false;
  scene.isSessionVisible = true;
  scene.numCarClasses = 3;
  scene.fields = threeClasses();
  scene.asked = [];
  configure();
});

describe('ClassFields', () => {
  it('draws one chip per class, in the order given, with running of entered', () => {
    render(<ClassFields />);

    expect(chips().map((element) => element.textContent)).toEqual([
      'LMP214/14',
      'LMP310/10',
      'LMGT314/14',
    ]);
  });

  it('draws the class name as the shared class label', () => {
    render(<ClassFields />);

    const labels = screen.getAllByTestId('class-label');
    expect(labels.map((label) => label.textContent)).toEqual([
      'LMP2',
      'LMP3',
      'LMGT3',
    ]);
    // A short bar in the class colour before the name, as the standings
    // draw a class by default.
    expect(labels[0].className).not.toContain('border-l-4');
    expect(labels[0].querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('shows the cars running alone with the total off', () => {
    configure({ showTotal: false });
    render(<ClassFields />);

    expect(chip('LMP3').textContent).toBe('LMP310');
    expect(screen.queryByTestId('class-field-total')).toBeNull();
  });

  it('keeps the count of cars out to itself unless asked', () => {
    scene.fields = [field('LMGT3', { active: 12, isFocusClass: true })];
    render(<ClassFields />);

    expect(chip('LMGT3').textContent).toBe('LMGT312/14');
    expect(screen.queryByTestId('class-field-inactive')).toBeNull();
  });

  it('shows the cars out behind their icon when asked', () => {
    scene.fields = [
      field('LMP2'),
      field('LMGT3', { active: 12, isFocusClass: true }),
    ];
    configure({ showInactive: true });
    render(<ClassFields />);

    const out = within(chip('LMGT3')).getByTestId('class-field-inactive');
    expect(out.textContent).toBe('2');
    // A caution, not the player's amber.
    expect(out.className).toContain('text-amber-400');
    expect(out.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Out of the running'
    );
    // A full class has nobody out, and says nothing.
    expect(
      within(chip('LMP2')).queryByTestId('class-field-inactive')
    ).toBeNull();
  });

  it('shows the cars in the pit lane behind their icon when asked', () => {
    scene.fields = [field('LMP2', { inPitLane: 3 }), field('LMP3')];
    configure({ showInPitLane: true });
    render(<ClassFields />);

    const pit = within(chip('LMP2')).getByTestId('class-field-pit');
    expect(pit.textContent).toBe('3');
    expect(pit.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'In the pit lane'
    );
    expect(within(chip('LMP3')).queryByTestId('class-field-pit')).toBeNull();
  });

  it('selects the class of the focus car', () => {
    render(<ClassFields />);

    expect(chip('LMGT3').dataset.focus).toBe('true');
    expect(chip('LMGT3').className).toContain('overlay-selected');
    expect(chip('LMP2').dataset.focus).toBeUndefined();
    expect(chip('LMP2').className).not.toContain('overlay-selected');
  });

  it('outlines nothing with the highlight off', () => {
    configure({ highlightOwnClass: false });
    render(<ClassFields />);

    expect(chips().some((element) => element.dataset.focus)).toBe(false);
  });

  it('outlines nothing in a single-class race, where there is nothing to tell apart', () => {
    scene.numCarClasses = 1;
    scene.fields = [
      field('GT3', { total: 24, active: 23, isFocusClass: true }),
    ];
    render(<ClassFields />);

    expect(chips()).toHaveLength(1);
    expect(chip('GT3').textContent).toBe('GT323/24');
    expect(chip('GT3').dataset.focus).toBeUndefined();
  });

  it('keeps the focus class among the chips when not every class fits', () => {
    configure({ maxClasses: 2 });
    render(<ClassFields />);

    expect(chips().map((element) => element.dataset.class)).toEqual([
      'LMP2',
      'LMGT3',
    ]);
  });

  it('asks for the classes in the order the setting names', () => {
    configure({ order: 'classSpeed' });
    render(<ClassFields />);

    expect(scene.asked[0]).toBe('classSpeed');
  });

  it('lays the chips out in a column, the labels on one grid', () => {
    configure({ orientation: 'vertical' });
    render(<ClassFields />);

    expect(screen.getByTestId('class-fields').className).toContain('grid');
    expect(chip('LMP2').className).toContain('grid-cols-subgrid');
  });

  it('takes its background opacity from the settings', () => {
    configure({ background: { opacity: 35 } });
    render(<ClassFields />);

    expect(
      screen.getByTestId('class-fields').style.getPropertyValue('--bg-opacity')
    ).toBe('35%');
  });

  it('renders nothing without classes: no session, or no drivers yet', () => {
    scene.fields = [];
    const { container } = render(<ClassFields />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing in a session it is switched off for', () => {
    scene.isSessionVisible = false;
    const { container } = render(<ClassFields />);

    expect(container.innerHTML).toBe('');
  });
});

describe('ClassFields set to show only when on track', () => {
  beforeEach(() => {
    scene.isDriving = false;
    configure({ showOnlyWhenOnTrack: true });
  });

  it('is shown while driving', () => {
    scene.isDriving = true;
    render(<ClassFields />);

    expect(chips()).toHaveLength(3);
  });

  it('is shown while watching a car, as through a team-mate’s stint', () => {
    scene.isWatching = true;
    render(<ClassFields />);

    expect(chips()).toHaveLength(3);
    // Subscribed: the summary is read while the widget is on screen.
    expect(scene.asked[1]).toBe(true);
  });

  it('is hidden while neither: in the garage, or in the menus', () => {
    const { container } = render(<ClassFields />);

    expect(container.innerHTML).toBe('');
    // And does not keep the standings channel open for a hidden widget.
    expect(scene.asked[1]).toBe(false);
  });

  it('is shown anywhere with the setting off', () => {
    configure({ showOnlyWhenOnTrack: false });
    render(<ClassFields />);

    expect(chips()).toHaveLength(3);
  });
});
