import { SessionProvider } from '@irdashies/context';
import type { BrowserConnection, IrSdkBridge } from '@irdashies/types';
import { PitWallConnection } from '../components/PitWall/PitWallConnection';
import { PitWallDeviceLayout } from '../components/PitWall/PitWallDeviceLayout';
import { PitWallContent } from './PitWallWindow';

/**
 * The Pit Wall as a browser shows it: the page its window shows, with three
 * differences that come from where it is.
 *
 * - The layout is a choice of the device and is kept in its browser. A
 *   tablet on Compact leaves the window on the monitor as it was.
 * - There is no settings window to open from a browser, so the page has no
 *   gears. It finds that out from the dashboard bridge it is given, which in
 *   a browser has no such call.
 * - Everything it shows comes over one socket. While that is down the page
 *   keeps what it last had, and its header says it is reconnecting.
 *
 * It goes inside a DashboardProvider and a RunningStateProvider, like the
 * window's content.
 *
 * @param bridge Where the session comes from: the page's socket.
 * @param connection Whether that socket is up.
 */
export const PitWallBrowserPage = ({
  bridge,
  connection,
}: {
  bridge: IrSdkBridge;
  connection: BrowserConnection;
}) => (
  <>
    {/* The header reads the session; the panels' widgets share it. */}
    <SessionProvider bridge={bridge} />
    <PitWallConnection connection={connection}>
      <PitWallDeviceLayout>
        <PitWallContent />
      </PitWallDeviceLayout>
    </PitWallConnection>
  </>
);
PitWallBrowserPage.displayName = 'PitWallBrowserPage';
