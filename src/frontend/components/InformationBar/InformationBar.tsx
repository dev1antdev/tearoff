import {
  useGeneralSettings,
  useDrivingState,
  useSessionVisibility,
} from '@irdashies/context';
import { SessionBar } from '../Standings/components/SessionBar/SessionBar';
import { useInformationBarSettings } from '@irdashies/domain';
import { IconContext } from '@phosphor-icons/react';
import { OVERLAY_ICONS } from '@irdashies/utils/overlayIcons';

export const InformationBar = () => {
  const settings = useInformationBarSettings();
  const generalSettings = useGeneralSettings();
  const { isDriving, isWatching } = useDrivingState();
  const isSessionVisible = useSessionVisibility(settings?.sessionVisibility);

  if (!settings?.enabled) {
    return null;
  }

  if (!isSessionVisible) {
    return null;
  }

  // Show only when on track: driving, or watching a car that is out of its
  // garage. The bar is about the session, which goes on either way.
  if (settings?.showOnlyWhenOnTrack && !(isDriving || isWatching)) {
    return null;
  }

  const isCompact =
    generalSettings?.compactMode === 'compact' ||
    generalSettings?.compactMode === 'ultra';

  return (
    <IconContext.Provider value={OVERLAY_ICONS}>
      <div
        className={`w-full overlay-panel ${!isCompact ? 'p-2' : ''} overflow-hidden pointer-events-none`}
        style={{
          ['--bg-opacity' as string]: `${settings?.background?.opacity ?? 60}%`,
        }}
      >
        <SessionBar
          settings={settings}
          opacity={settings?.foreground?.opacity}
          standalone
        />
      </div>
    </IconContext.Provider>
  );
};

InformationBar.displayName = 'InformationBar';
