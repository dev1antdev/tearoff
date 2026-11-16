import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isPitWallLayoutId, type PitWallLayoutId } from '@irdashies/types';
import logger from '@irdashies/utils/logger';

/** The layout chosen in this browser. A preference of the device. */
export const PIT_WALL_DEVICE_LAYOUT_KEY = 'irdashies:pitwall:layout';

interface DeviceLayout {
  /** Undefined until one is chosen here: the profile's layout is shown. */
  layout: PitWallLayoutId | undefined;
  setLayout: (layout: PitWallLayoutId) => void;
}

const DeviceLayoutContext = createContext<DeviceLayout | null>(null);

// What a browser kept is untrusted: anything but a known layout is nothing.
const readStored = (): PitWallLayoutId | undefined => {
  try {
    const stored = localStorage.getItem(PIT_WALL_DEVICE_LAYOUT_KEY);
    return isPitWallLayoutId(stored) ? stored : undefined;
  } catch (error) {
    logger.warn('[PitWall] Could not read the layout kept here', error);
    return undefined;
  }
};

const writeStored = (layout: PitWallLayoutId) => {
  try {
    localStorage.setItem(PIT_WALL_DEVICE_LAYOUT_KEY, layout);
  } catch (error) {
    // Storage unavailable: the choice holds until the page is closed.
    logger.warn('[PitWall] Could not keep the layout here', error);
  }
};

/**
 * Makes the Pit Wall's layout a choice of the device the page is open on.
 *
 * The window saves the layout into the profile. A browser must not: a tablet
 * switched to Compact would switch the window on the monitor with it. Below
 * this the header's switch keeps its choice in the browser's local storage
 * and nothing is saved; until a choice is made the profile's layout is shown.
 */
export const PitWallDeviceLayout = ({ children }: { children: ReactNode }) => {
  const [layout, setChosen] = useState(readStored);
  const setLayout = useCallback((next: PitWallLayoutId) => {
    setChosen(next);
    writeStored(next);
  }, []);
  const value = useMemo(() => ({ layout, setLayout }), [layout, setLayout]);
  return (
    <DeviceLayoutContext.Provider value={value}>
      {children}
    </DeviceLayoutContext.Provider>
  );
};

/** Null in the app's own window, where the layout belongs to the profile. */
export const usePitWallDeviceLayout = (): DeviceLayout | null =>
  useContext(DeviceLayoutContext);
