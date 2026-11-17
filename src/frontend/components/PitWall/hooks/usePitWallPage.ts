import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  useActiveSimulator,
  useDashboard,
  useSimWidgetSupport,
} from '@irdashies/context';
import {
  PIT_WALL_PHONE_MAX_WIDTH,
  PIT_WALL_WIDGET_ID,
  resolvePitWall,
  sanitizePitWallConfig,
  type PitWallConfig,
  type PitWallLayoutId,
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

/**
 * Saves one choice of the page into the Pit Wall's own config. Does nothing
 * while the profile has no Pit Wall widget to save it in, or while the
 * choice is the one already saved.
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
      if (keys.every((key) => config[key] === change[key])) return;
      onDashboardUpdated({
        ...currentDashboard,
        widgets: currentDashboard.widgets.map((widget) =>
          widget.id === PIT_WALL_WIDGET_ID
            ? { ...widget, config: { ...widget.config, ...change } }
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
    (layout: PitWallLayoutId) => {
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
