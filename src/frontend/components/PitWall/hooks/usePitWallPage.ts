import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  useActiveSimulator,
  useDashboard,
  useSimWidgetSupport,
} from '@irdashies/context';
import {
  PIT_WALL_CUSTOM_START,
  PIT_WALL_PHONE_MAX_WIDTH,
  PIT_WALL_WIDGET_ID,
  resolvePitWall,
  samePitWallCustom,
  sanitizePitWallConfig,
  type PitWallConfig,
  type PitWallCustomPanel,
  type PitWallLayoutChoice,
  type PitWallTabId,
  type ResolvedPitWall,
} from '@irdashies/types';
import { usePitWallDeviceLayout } from '../PitWallDeviceLayout';

const PHONE_QUERY = `(max-width: ${PIT_WALL_PHONE_MAX_WIDTH - 1}px)`;

/** Nothing to ask where there is no page to measure, as in a spec. */
const phoneQuery = (): MediaQueryList | undefined =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY)
    : undefined;

const subscribeToPhone = (onChange: () => void) => {
  const query = phoneQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
};

const isPhone = () => phoneQuery()?.matches ?? false;

/**
 * Whether the page is as narrow as a phone. Asked of the browser instead of
 * measured, so the answer is there on the first draw and the page and its
 * host, which both resolve the page, never differ. The app's own window
 * cannot be made this narrow.
 */
export const usePitWallPhone = (): boolean =>
  useSyncExternalStore(subscribeToPhone, isPhone, () => false);

/**
 * The page the saved dashboard describes, less any panel the running sim
 * cannot support. In a browser the layout and the tab in front are the ones
 * chosen on that device, where they have been; on a phone the page is the
 * tabs, with the panels of a tab one under another.
 */
export const usePitWallPage = (): ResolvedPitWall => {
  const { currentDashboard } = useDashboard();
  const simulator = useActiveSimulator();
  const support = useSimWidgetSupport();
  const device = usePitWallDeviceLayout();
  const layout = device?.layout;
  const tab = device?.tab;
  const phone = usePitWallPhone();
  return useMemo(
    () =>
      resolvePitWall(
        currentDashboard,
        { support, simulator },
        { layout, tab, phone }
      ),
    [currentDashboard, support, simulator, layout, tab, phone]
  );
};

/** What is saved for a key is what the change would save. */
const isSaved = (saved: unknown, change: unknown): boolean =>
  saved === change || JSON.stringify(saved) === JSON.stringify(change);

/**
 * Saves one choice of the page into the Pit Wall's own config. Does nothing
 * while the profile has no Pit Wall widget to save it in, or while the
 * choice is the one already saved. A key given as undefined is taken out
 * of the config.
 */
const useSaveToProfile = () => {
  const { currentDashboard, onDashboardUpdated } = useDashboard();
  return useCallback(
    (change: Partial<PitWallConfig>) => {
      if (!currentDashboard || !onDashboardUpdated) return;
      const saved = currentDashboard.widgets.find(
        (widget) => widget.id === PIT_WALL_WIDGET_ID
      );
      if (!saved) return;
      const config = sanitizePitWallConfig(saved.config);
      const keys = Object.keys(change) as (keyof PitWallConfig)[];
      if (keys.every((key) => isSaved(config[key], change[key]))) return;
      // Without the keys that have no value: one given as undefined is
      // how a key is taken out.
      const next = Object.fromEntries(
        Object.entries({ ...saved.config, ...change }).filter(
          ([, value]) => value !== undefined
        )
      );
      onDashboardUpdated({
        ...currentDashboard,
        widgets: currentDashboard.widgets.map((widget) =>
          widget.id === PIT_WALL_WIDGET_ID
            ? { ...widget, config: next }
            : widget
        ),
      });
    },
    [currentDashboard, onDashboardUpdated]
  );
};

/**
 * Saves the layout the header's switch chose into the Pit Wall's own config.
 *
 * In a browser the choice is kept on the device and the profile is left as
 * it is.
 */
export const useSetPitWallLayout = () => {
  const save = useSaveToProfile();
  const device = usePitWallDeviceLayout();
  return useCallback(
    (layout: PitWallLayoutChoice) => {
      if (device) device.setLayout(layout);
      else save({ layout });
    },
    [save, device]
  );
};

/**
 * Keeps the tab the tab bar chose the way the layout is kept: in the
 * profile for the window, on the device for a browser.
 */
export const useSetPitWallTab = () => {
  const save = useSaveToProfile();
  const device = usePitWallDeviceLayout();
  return useCallback(
    (tab: PitWallTabId) => {
      if (device) device.setTab(tab);
      else save({ tab });
    },
    [save, device]
  );
};

/**
 * Saves the panels of the Custom layout as the user arranged them, into the
 * Pit Wall's own config, by the road the layout and the tab are saved.
 *
 * An arrangement that is the one the layout starts with is saved as no
 * list at all: the layout then goes on being Race as each version has it,
 * as it was before the user touched it.
 *
 * In a browser nothing is saved and nothing is kept. The arrangement is
 * the profile's, and a page in a browser changes nothing of a profile but
 * where its own widgets sit (rule R12.6).
 */
export const useSetPitWallCustom = () => {
  const save = useSaveToProfile();
  const device = usePitWallDeviceLayout();
  return useCallback(
    (panels: readonly PitWallCustomPanel[]) => {
      if (device) return;
      save({
        custom: samePitWallCustom(panels, PIT_WALL_CUSTOM_START)
          ? undefined
          : panels.map(({ widget, x, y, w, h }) => ({ widget, x, y, w, h })),
      });
    },
    [save, device]
  );
};
