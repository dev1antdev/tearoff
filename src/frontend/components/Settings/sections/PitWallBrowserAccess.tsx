import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { useDashboard } from '@irdashies/context';
import {
  browserPageUrl,
  type BrowserAccess,
  type BrowserAccessBridge,
} from '@irdashies/types';
import { BrowserLinkField } from '../components/BrowserLinkField';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SettingDivider } from '../components/SettingDivider';
import { SettingsSection } from '../components/SettingSection';
import { useBrowserAccess } from '../hooks/useBrowserAccess';

const PIT_WALL_PATH = '/pitwall';

const headingClass = 'text-md font-medium text-slate-300';
const noteClass = 'text-sm text-slate-500';

const GeneralSettingsLink = () => (
  <Link
    to="/settings/general"
    className="text-accent-400 hover:text-accent-300 underline"
  >
    General settings
  </Link>
);

const Row = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-2">
    <h4 className={headingClass}>{title}</h4>
    {children}
  </div>
);

const devicesConnected = (devices: number): string =>
  devices === 0
    ? 'No other device is connected right now.'
    : devices === 1
      ? '1 other device is connected right now.'
      : `${devices} other devices are connected right now.`;

interface OtherDevicesProps {
  access: BrowserAccess;
  /** What the switch in General settings says, which takes a restart. */
  networkWanted: boolean;
  replaceKey: () => Promise<boolean>;
}

/** The link a tablet or a second PC opens, and the key it carries. */
const OtherDevices = ({
  access,
  networkWanted,
  replaceKey,
}: OtherDevicesProps) => {
  const [confirming, setConfirming] = useState(false);
  const [replaceFailed, setReplaceFailed] = useState(false);

  if (!access.networkAccess) {
    return (
      <p className={noteClass}>
        {networkWanted ? (
          <>
            Enable Network Access is switched on in <GeneralSettingsLink /> but
            has not taken effect yet. Restart Tearoff, and the link for other
            devices appears here.
          </>
        ) : (
          <>
            Network access is off, so only this PC can open the page. To use a
            tablet or a second PC, turn on Enable Network Access in{' '}
            <GeneralSettingsLink /> and restart Tearoff.
          </>
        )}
      </p>
    );
  }

  if (!access.host || !access.key) {
    return (
      <p className={noteClass} role="alert">
        {access.host
          ? 'Tearoff could not make the key other devices need. Restart Tearoff to try again.'
          : 'Tearoff found no network address for this PC. Connect it to your network and restart Tearoff.'}
      </p>
    );
  }

  const confirm = () => {
    setConfirming(false);
    void replaceKey().then((replaced) => setReplaceFailed(!replaced));
  };

  return (
    <>
      <p className={noteClass}>
        For a tablet or a second PC on your own network. The link carries a key,
        and a device without it is refused everything, so give the link only to
        devices of your own. This PC needs no key.
      </p>
      <BrowserLinkField
        label="Pit Wall link for other devices"
        url={browserPageUrl({
          host: access.host,
          port: access.port,
          path: PIT_WALL_PATH,
          key: access.key,
        })}
        secret={access.key}
        primary
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm text-slate-300" role="status">
            {devicesConnected(access.devices)}
          </p>
          <p className={`${noteClass} mt-1`}>
            A new key replaces this one at once: every device has to open the
            new link, and the ones connected now are disconnected.
          </p>
        </div>
        <button
          type="button"
          className="settings-button"
          onClick={() => setConfirming(true)}
        >
          New key
        </button>
      </div>
      {replaceFailed && (
        <p className="text-sm text-red-300" role="alert">
          The key could not be replaced. The old one is still in force.
        </p>
      )}
      {!networkWanted && (
        <p className={noteClass}>
          Enable Network Access has been switched off in <GeneralSettingsLink />
          . Other devices can still connect until Tearoff restarts.
        </p>
      )}
      <ConfirmDialog
        isOpen={confirming}
        title="Make a new key?"
        message="Every device that opened the page with the current link is disconnected, and is refused until it opens the new link."
        confirmText="New key"
        cancelText="Keep this key"
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
        variant="warning"
      />
    </>
  );
};

interface PitWallBrowserAccessProps {
  /** For stories and specs; the app uses the preload bridge. */
  bridge?: BrowserAccessBridge;
}

/**
 * Where the Pit Wall page is in a browser: the link for this PC, and the
 * link for other devices with the key they need. It only reports whether
 * the server answers other devices; the switch for that stays in General
 * settings, and nothing here turns it.
 */
export const PitWallBrowserAccess = ({ bridge }: PitWallBrowserAccessProps) => {
  const { currentDashboard } = useDashboard();
  const { access, available, failed, replaceKey } = useBrowserAccess(bridge);
  const general = currentDashboard?.generalSettings;
  const serverWanted = general?.enableWebServer ?? true;
  const networkWanted = general?.enableNetworkAccess ?? false;

  let body: ReactNode;
  if (!available) {
    body = <p className={noteClass}>The links are shown in the Tearoff app.</p>;
  } else if (failed) {
    body = (
      <p className={noteClass} role="alert">
        Could not load the links. Close and reopen this page to try again.
      </p>
    );
  } else if (!access) {
    body = (
      <p className={noteClass} role="status">
        Loading the links...
      </p>
    );
  } else if (!access.listening) {
    body = (
      <p className={noteClass}>
        {serverWanted ? (
          <>
            The built-in web server is not running, so the page cannot be opened
            in a browser. If Enable Web Server was just switched on in{' '}
            <GeneralSettingsLink />, restart Tearoff.
          </>
        ) : (
          <>
            The built-in web server is turned off, so the page cannot be opened
            in a browser. Turn on Enable Web Server in <GeneralSettingsLink />{' '}
            and restart Tearoff.
          </>
        )}
      </p>
    );
  } else {
    const localUrl = browserPageUrl({
      host: 'localhost',
      port: access.port,
      path: PIT_WALL_PATH,
    });
    body = (
      <>
        <Row title="On this PC">
          <p className={noteClass}>
            For a browser on this PC, or a browser source in OBS.
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <BrowserLinkField
                label="Pit Wall link for this PC"
                url={localUrl}
              />
            </div>
            <a
              href={localUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="settings-button whitespace-nowrap"
            >
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
              Open
            </a>
          </div>
        </Row>

        <SettingDivider />

        <Row title="On another device">
          <OtherDevices
            access={access}
            networkWanted={networkWanted}
            replaceKey={replaceKey}
          />
        </Row>
      </>
    );
  }

  return (
    <SettingsSection title="In a browser">
      <p className="text-sm text-slate-400">
        The same page in an ordinary browser, served by Tearoff itself. A layout
        chosen in a browser is kept by that browser and leaves the window as it
        is.
      </p>
      {body}
    </SettingsSection>
  );
};
PitWallBrowserAccess.displayName = 'PitWallBrowserAccess';
