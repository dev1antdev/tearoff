import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboard,
  useFlagStateSnapshot,
  useGeneralSettings,
  useSessionVisibility,
  useTrackStateSelector,
} from '@irdashies/context';
import {
  EMPTY_FLAG_STATE,
  FLAG_ACTIVE_BLUE,
  FLAG_ACTIVE_GREEN,
  FLAG_ACTIVE_YELLOW,
  getWidgetDefaultConfig,
  type FlagConfig,
  type FlagStateSnapshot,
} from '@irdashies/types';
import { Flag } from './Flag';

vi.mock('@irdashies/context', () => ({
  trackStateSelectors: { isOnTrack: 'isOnTrack' },
  useDashboard: vi.fn(),
  useFlagStateSnapshot: vi.fn(),
  useGeneralSettings: vi.fn(),
  useSessionVisibility: vi.fn(),
  useTrackStateSelector: vi.fn(),
}));

// The matrix sizes itself to its box, which jsdom does not lay out.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  }
);

const defaults = getWidgetDefaultConfig('flag');

const state = (overrides: Partial<FlagStateSnapshot>): FlagStateSnapshot => ({
  ...EMPTY_FLAG_STATE,
  ...overrides,
});

const clearTrack = state({
  kind: 'green',
  detail: 'trackClear',
  active: FLAG_ACTIVE_GREEN,
});

/** The label under the matrix, which names the flag that is drawn. */
const drawn = (
  snapshot: FlagStateSnapshot | undefined,
  config: Partial<FlagConfig> = {},
  isOnTrack = true
): string | null => {
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: {
      widgets: [
        {
          id: 'flag',
          enabled: true,
          // The blink would draw NO FLAG on every other beat.
          config: { ...defaults, showLabel: true, animate: false, ...config },
        },
      ],
    },
  } as unknown as ReturnType<typeof useDashboard>);
  vi.mocked(useGeneralSettings).mockReturnValue(undefined);
  vi.mocked(useFlagStateSnapshot).mockReturnValue(snapshot);
  vi.mocked(useSessionVisibility).mockReturnValue(true);
  vi.mocked(useTrackStateSelector).mockReturnValue(isOnTrack);
  const { container } = render(<Flag />);
  return container.querySelector('span')?.textContent ?? null;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Flag', () => {
  it('is green while the track is clear', () => {
    // Under Le Mans Ultimate it never was: the session flags it used to read
    // have no green bit there.
    expect(drawn(clearTrack)).toBe('GREEN');
  });

  it('draws a blue the processor ranked over a yellow elsewhere', () => {
    // The other fault: any sector yellow, anywhere, used to hide the blue.
    const blueOverYellow = state({
      kind: 'blue',
      detail: 'blueLapping',
      active: FLAG_ACTIVE_BLUE | FLAG_ACTIVE_YELLOW | FLAG_ACTIVE_GREEN,
    });

    expect(drawn(blueOverYellow)).toBe('BLUE');
  });

  it('draws both yellows as yellow and a penalty as the black flag', () => {
    expect(drawn(state({ kind: 'yellow', detail: 'yellowAhead' }))).toBe(
      'YELLOW'
    );
    expect(drawn(state({ kind: 'fullCourseYellow', detail: 'fcy' }))).toBe(
      'YELLOW'
    );
    expect(drawn(state({ kind: 'penalty', detail: 'driveThrough' }))).toBe(
      'BLACK'
    );
    expect(drawn(state({ kind: 'chequered', detail: 'finished' }))).toBe(
      'CHECKERED'
    );
  });

  it('draws no flag before the start and without data', () => {
    expect(drawn(state({ kind: 'start', detail: 'grid' }))).toBe('NO');
    expect(drawn(undefined)).toBe('NO');
  });

  describe('with green only while it is announced', () => {
    const announcedOnly = { greenWhenClear: false };

    it('draws no flag on a clear track', () => {
      expect(drawn(clearTrack, announcedOnly)).toBe('NO');
    });

    it('still draws the green of the start and of a restart', () => {
      expect(
        drawn({ ...clearTrack, detail: 'greenStart' }, announcedOnly)
      ).toBe('GREEN');
      expect(
        drawn({ ...clearTrack, detail: 'greenRestart' }, announcedOnly)
      ).toBe('GREEN');
    });

    it('hides the widget on a clear track when no flag is not shown', () => {
      expect(
        drawn(clearTrack, { greenWhenClear: false, showNoFlagState: false })
      ).toBeNull();
    });
  });

  it('hides when not on track only if asked to', () => {
    expect(drawn(clearTrack, {}, false)).toBe('GREEN');
    expect(drawn(clearTrack, { showOnlyWhenOnTrack: true }, false)).toBeNull();
  });
});
