import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  isPitWallLayoutChoice,
  isPitWallTabId,
  type PitWallLayoutChoice,
  type PitWallTabId,
} from '@irdashies/types';
import logger from '@irdashies/utils/logger';

/** The layout chosen in this browser. A preference of the device. */
export const PIT_WALL_DEVICE_LAYOUT_KEY = 'irdashies:pitwall:layout';

/** The tab in front in this browser, kept the same way. */
export const PIT_WALL_DEVICE_TAB_KEY = 'irdashies:pitwall:tab';

interface DeviceLayout {
  /** Undefined until one is chosen here: the profile's layout is shown. */
  layout: PitWallLayoutChoice | undefined;
  setLayout: (layout: PitWallLayoutChoice) => void;
  /** Undefined until one is chosen here: the profile's tab is in front. */
  tab: PitWallTabId | undefined;
  setTab: (tab: PitWallTabId) => void;
}

const DeviceLayoutContext = createContext<DeviceLayout | null>(null);

// What a browser kept is untrusted: anything but a known value is nothing.
const readStored = <Value extends string>(
  key: string,
  isKnown: (value: unknown) => value is Value
): Value | undefined => {
  try {
    const stored = localStorage.getItem(key);
    return isKnown(stored) ? stored : undefined;
  } catch (error) {
    logger.warn('[PitWall] Could not read what is kept here', key, error);
    return undefined;
  }
};

const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Storage unavailable: the choice holds until the page is closed.
    logger.warn('[PitWall] Could not keep the choice here', key, error);
  }
};

/**
 * Makes the Pit Wall's layout, and the tab in front, choices of the device
 * the page is open on.
 *
 * The window saves both into the profile. A browser must not: a tablet
 * switched to Compact would switch the window on the monitor with it. Below
 * this the header's switch and the tab bar keep their choices in the
 * browser's local storage and nothing is saved; until a choice is made the
 * profile's is shown.
 */
export const PitWallDeviceLayout = ({ children }: { children: ReactNode }) => {
  const [layout, setChosenLayout] = useState(() =>
    readStored(PIT_WALL_DEVICE_LAYOUT_KEY, isPitWallLayoutChoice)
  );
  const [tab, setChosenTab] = useState(() =>
    readStored(PIT_WALL_DEVICE_TAB_KEY, isPitWallTabId)
  );
  const setLayout = useCallback((next: PitWallLayoutChoice) => {
    setChosenLayout(next);
    writeStored(PIT_WALL_DEVICE_LAYOUT_KEY, next);
  }, []);
  const setTab = useCallback((next: PitWallTabId) => {
    setChosenTab(next);
    writeStored(PIT_WALL_DEVICE_TAB_KEY, next);
  }, []);
  const value = useMemo(
    () => ({ layout, setLayout, tab, setTab }),
    [layout, setLayout, tab, setTab]
  );
  return (
    <DeviceLayoutContext.Provider value={value}>
      {children}
    </DeviceLayoutContext.Provider>
  );
};

/** Null in the app's own window, where both belong to the profile. */
export const usePitWallDeviceLayout = (): DeviceLayout | null =>
  useContext(DeviceLayoutContext);
