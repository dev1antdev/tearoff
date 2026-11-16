/**
 * The built-in web server as the settings window sees it: where its pages
 * are, and what a device that is not this PC needs to open them.
 *
 * This PC opens every page with nothing more than its address. Any other
 * device has to show the key, which the links for other devices carry. The
 * key is kept in a file of its own, never in a dashboard, and is handed to
 * the settings window only.
 */
export interface BrowserAccess {
  /** The server is answering on `port`. False when it is switched off. */
  listening: boolean;
  port: number;
  /**
   * The server answers other devices. This is how the app started, not what
   * the switch in General settings says now: the switch takes a restart.
   */
  networkAccess: boolean;
  /**
   * This PC's address on the network, for the links other devices open.
   * Null while the server answers this PC only, or no network was found.
   */
  host: string | null;
  /** The key those links carry. Null while the server answers this PC only. */
  key: string | null;
  /** Other devices with a page connected right now. */
  devices: number;
}

/** What the settings window asks about the pages a browser can open. */
export interface BrowserAccessBridge {
  getAccess: () => Promise<BrowserAccess>;
  /**
   * Replaces the key at once: a device holding the old one is refused on its
   * next request and its open connections are closed. Rejects, with the old
   * key still in force, when the new one could not be stored.
   */
  replaceKey: () => Promise<BrowserAccess>;
  /** Fires with the count on subscribing and whenever it changes. */
  onDevicesChanged: (callback: (devices: number) => void) => () => void;
}

/** The name of the key in a link: `?key=`. */
export const DEVICE_KEY_PARAM = 'key';

/**
 * What the server closes a device's connection with when its key has been
 * replaced, so the page stops trying to come back with the old one.
 */
export const KEY_REPLACED_CLOSE_CODE = 4403;

export interface BrowserPageLink {
  host: string;
  port: number;
  /** The page's path on the server, such as `/pitwall`. */
  path: string;
  /** The profile the page shows; left out, the one in use when it opens. */
  profile?: string;
  /** For a device that is not this PC. This PC's links never carry it. */
  key?: string | null;
}

/** The address of one of the server's pages. */
export const browserPageUrl = ({
  host,
  port,
  path,
  profile,
  key,
}: BrowserPageLink): string => {
  const query = [
    profile ? `profile=${encodeURIComponent(profile)}` : '',
    key ? `${DEVICE_KEY_PARAM}=${encodeURIComponent(key)}` : '',
  ].filter(Boolean);
  return `http://${host}:${port}${path}${query.length ? `?${query.join('&')}` : ''}`;
};

/**
 * A link as it is put on the screen: with the key in it replaced by dots,
 * so that a settings window on a stream or in a screenshot gives nothing
 * away. The link that is copied is the whole one.
 */
export const maskDeviceKey = (
  url: string,
  key: string | null | undefined
): string =>
  key
    ? url.replace(
        `${DEVICE_KEY_PARAM}=${encodeURIComponent(key)}`,
        `${DEVICE_KEY_PARAM}=${'•'.repeat(8)}`
      )
    : url;

/**
 * Whether a link names this PC itself, so that it is only good on this PC
 * and needs no key.
 */
export const isLocalHostName = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
