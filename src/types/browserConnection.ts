/**
 * A browser page's connection to the app, as the page itself sees it.
 *
 * A page served to a browser gets everything it shows over one socket.
 * While the socket is down the page goes on showing what it last had, so
 * whatever draws the page says that it is not connected. The app's own
 * windows have no socket, and nothing of this.
 */
export interface BrowserConnection {
  /** The socket is open. */
  isConnected: () => boolean;
  /** Calls back when the socket goes down and when it is back. */
  onConnectionChanged: (listener: (connected: boolean) => void) => () => void;
}
