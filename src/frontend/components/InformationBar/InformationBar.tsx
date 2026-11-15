import {
  useGeneralSettings,
  useDrivingState,
  useSessionVisibility,
} from '@irdashies/context';
import { SessionBar } from '../Standings/components/SessionBar/SessionBar';
import { useInformationBarSettings } from '@irdashies/domain';

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
    <div
      className={`w-full bg-slate-800/(--bg-opacity) rounded-sm ${!isCompact ? 'p-2' : ''} overflow-hidden pointer-events-none`}
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
  );
};

InformationBar.displayName = 'InformationBar';
