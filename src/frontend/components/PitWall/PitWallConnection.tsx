import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { BrowserConnection } from '@irdashies/types';

const ConnectionContext = createContext<BrowserConnection | null>(null);

/**
 * Tells the Pit Wall below it about the socket the page is fed over.
 *
 * A page in a browser goes on showing what it last had when its socket
 * drops: the race is not over, the page has only stopped hearing of it. The
 * header says so while that lasts. The app's own window has no socket and
 * is not put inside this.
 */
export const PitWallConnection = ({
  connection,
  children,
}: {
  connection: BrowserConnection;
  children: ReactNode;
}) => (
  <ConnectionContext.Provider value={connection}>
    {children}
  </ConnectionContext.Provider>
);
PitWallConnection.displayName = 'PitWallConnection';

const neverChanges = () => () => undefined;
const alwaysConnected = () => true;

/**
 * True while the page's socket is down and it is trying to get it back.
 * Always false in the app's own window.
 */
export const usePitWallReconnecting = (): boolean => {
  const connection = useContext(ConnectionContext);
  return !useSyncExternalStore(
    connection?.onConnectionChanged ?? neverChanges,
    connection?.isConnected ?? alwaysConnected
  );
};
