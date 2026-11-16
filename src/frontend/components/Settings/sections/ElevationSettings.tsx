import { useEffect, useState } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  ElevationWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
  type TrackElevationSource,
  type TrackProfileBridge,
} from '@irdashies/types';
import { useDashboard, useTrackProfileSnapshot } from '@irdashies/context';
import logger from '@irdashies/utils/logger';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import { ConfirmDialog } from '../components/ConfirmDialog';

const SETTING_ID = 'elevation';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('elevation');

/** Where the profile on screen came from, in a sentence. */
const SOURCE_TEXT: Record<TrackElevationSource, string> = {
  recorded: 'Recorded from a lap you drove.',
  integrated:
    "Worked out from your car's motion over the first laps you drove here. iRacing states no height, so this is the shape of the lap rather than a survey of it.",
  tinypedal:
    'Taken from a TinyPedal track map found on this computer. The first clean lap you drive replaces it.',
};

interface ElevationSettingsProps {
  /** As the settings loader hands it to every page. */
  widgetId?: string;
  /** For stories and specs; the app uses the preload bridge. */
  bridge?: TrackProfileBridge;
}

/**
 * The profile of the track of the running session: where it came from, and
 * the means to drop it so that the next clean lap records it again.
 */
const RecordedProfile = ({
  bridge,
}: {
  bridge: TrackProfileBridge | undefined;
}) => {
  const profile = useTrackProfileSnapshot();
  const [confirming, setConfirming] = useState(false);
  const trackKey = profile?.trackKey ?? null;
  const source = profile?.elevationSource ?? null;

  const clear = () => {
    setConfirming(false);
    if (!bridge || !trackKey) return;
    bridge
      .clearElevation(trackKey)
      .catch((error: unknown) =>
        logger.warn('Could not clear the elevation profile', error)
      );
  };

  return (
    <SettingsSection title="Recorded Profile">
      <p className="text-sm text-slate-400">
        The profile is recorded once for each track, from the first lap you
        drive from the line to the line without visiting the pits. Under Le Mans
        Ultimate that is the height of the road itself; under iRacing it is
        worked out from the car&apos;s motion over three laps.
      </p>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-4">
        <p className="min-w-0 flex-1 basis-40 text-sm text-slate-300">
          {trackKey === null
            ? 'Join a session to see the profile of its track.'
            : source === null
              ? profile?.recordingProgress != null
                ? `Recording now: ${Math.round(profile.recordingProgress * 100)}% of the lap driven.`
                : 'No profile for this track yet.'
              : SOURCE_TEXT[source]}
        </p>
        <button
          type="button"
          className="settings-button"
          disabled={!bridge || trackKey === null || source === null}
          onClick={() => setConfirming(true)}
        >
          Record again
        </button>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        title="Record Again"
        message="Forget the elevation profile of this track? The next clean lap you drive records it again. Your notes for the track are kept."
        confirmText="Forget Profile"
        cancelText="Keep"
        onConfirm={clear}
        onCancel={() => setConfirming(false)}
        variant="danger"
      />
    </SettingsSection>
  );
};

export const ElevationSettings = ({ bridge }: ElevationSettingsProps) => {
  const { currentDashboard } = useDashboard();
  const profileBridge = bridge ?? window.trackProfileBridge;

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as ElevationWidgetSettings | undefined;

  const [settings, setSettings] = useState<ElevationWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as ElevationWidgetSettings['config']) ??
      defaultConfig,
  });

  // Same guarded set-during-render sync as the other widget settings sections:
  // useState only reads its initialiser once, so mounting before the dashboard
  // has loaded would otherwise persist defaults over the saved config on the
  // next edit.
  const [prevSaved, setPrevSaved] = useState(savedSettings);
  if (JSON.stringify(savedSettings) !== JSON.stringify(prevSaved)) {
    setPrevSaved(savedSettings);
    if (savedSettings) {
      setSettings({
        id: SETTING_ID,
        enabled: savedSettings.enabled ?? false,
        config:
          (savedSettings.config as ElevationWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('elevationTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('elevationTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;

  return (
    <BaseSettingsSection
      title="Elevation"
      description="The height of the track along the lap as a filled profile, with your car's place on it, the part of the lap already driven, the sector starts and the height where you are. While you watch another car the mark is that car's."
      settings={settings as ElevationWidgetSettings}
      onSettingsChange={(s) => setSettings(s as ElevationWidgetSettings)}
      widgetId={SETTING_ID}
    >
      {(handleConfigChange) => (
        <SettingProps
          widget={SETTING_ID}
          config={config}
          onChange={handleConfigChange}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1 border-b border-slate-700 pb-1">
              <TabButton
                id="options"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                Options
              </TabButton>
              <TabButton
                id="visibility"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                Visibility
              </TabButton>
            </div>

            <div className="space-y-4">
              {activeTab === 'options' && (
                <>
                  <SettingsSection title="Display" scaleWidgetId={SETTING_ID}>
                    <SettingProp path="background.opacity" />
                    <SettingProp path="showProgress" />
                    <SettingProp path="showSectors" />
                  </SettingsSection>

                  <SettingsSection title="Figures">
                    <SettingProp path="showReading" />
                    {(config.showReading ?? defaultConfig.showReading) && (
                      <SettingProp path="zero" />
                    )}
                    <SettingProp path="showRange" />
                    <SettingProp path="unit" />
                  </SettingsSection>

                  <RecordedProfile bridge={profileBridge} />
                </>
              )}

              {activeTab === 'visibility' && (
                <SettingsSection title="Session Visibility">
                  <SessionVisibility
                    sessionVisibility={config.sessionVisibility}
                    handleConfigChange={handleConfigChange}
                  />

                  <SettingDivider />
                  <SettingProp path="showOnlyWhenOnTrack" />
                </SettingsSection>
              )}
            </div>
          </div>
        </SettingProps>
      )}
    </BaseSettingsSection>
  );
};
