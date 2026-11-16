import { SessionProvider } from '@irdashies/context';
import type { IrSdkBridge } from '@irdashies/types';
import { PitWallDeviceLayout } from '../components/PitWall/PitWallDeviceLayout';
import { PitWallContent } from './PitWallWindow';

/**
 * The Pit Wall as a browser shows it: the page its window shows, with two
 * differences that come from where it is.
 *
 * - The layout is a choice of the device and is kept in its browser. A
 *   tablet on Compact leaves the window on the monitor as it was.
 * - There is no settings window to open from a browser, so the page has no
 *   gears. It finds that out from the dashboard bridge it is given, which in
 *   a browser has no such call.
 *
 * It goes inside a DashboardProvider and a RunningStateProvider, like the
 * window's content.
 *
 * @param bridge Where the session comes from: the page's socket.
 */
export const PitWallBrowserPage = ({ bridge }: { bridge: IrSdkBridge }) => (
  <>
    {/* The header reads the session; the panels' widgets share it. */}
    <SessionProvider bridge={bridge} />
    <PitWallDeviceLayout>
      <PitWallContent />
    </PitWallDeviceLayout>
  </>
);
PitWallBrowserPage.displayName = 'PitWallBrowserPage';
