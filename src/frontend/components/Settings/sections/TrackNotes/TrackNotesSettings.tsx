import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BaseSettingsSection } from '../../components/BaseSettingsSection';
import {
  TrackNotesWidgetSettings,
  getWidgetDefaultConfig,
  type TrackProfileBridge,
  type TrackStateSnapshot,
} from '@irdashies/types';
import {
  getChannelSnapshotStore,
  useDashboard,
  useLovelyTrackData,
  useSessionStore,
  useTrackProfileSnapshot,
} from '@irdashies/context';
import { trackCornersFrom } from '@irdashies/domain/corners/trackCorners';
import { wrapLapFraction } from '@irdashies/shared';
import { TabButton } from '../../components/TabButton';
import { SessionVisibility } from '../../components/SessionVisibility';
import { SettingsSection } from '../../components/SettingSection';
import { SettingDivider } from '../../components/SettingDivider';
import { SettingProps, settingPropFor } from '../../components/SettingProp';
import { TrackNotesEditor } from './TrackNotesEditor';

const SETTING_ID = 'tracknotes';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('tracknotes');

type TrackNotesTab = 'notes' | 'options' | 'visibility';
const TABS: readonly TrackNotesTab[] = ['notes', 'options', 'visibility'];
const TAB_STORAGE_KEY = 'trackNotesTab';

const storedTab = (): TrackNotesTab => {
  const stored = localStorage.getItem(TAB_STORAGE_KEY);
  return TABS.find((tab) => tab === stored) ?? 'notes';
};

const selectLapFraction = (snapshot: TrackStateSnapshot): number =>
  wrapLapFraction(snapshot.lapDistPct);

/**
 * Where the player's car is on the lap, kept in a ref: the page asks for it
 * when a button is pressed and is not drawn again each time the car moves.
 * Null until the channel has said.
 */
const useLapFractionRef = () => {
  const fraction = useRef<number | null>(null);
  useEffect(() => {
    const bridge = window.channelBridge;
    if (!bridge) return;
    const store = getChannelSnapshotStore('track-state.snapshot', bridge);
    const selection = store.createSelection(selectLapFraction);
    const take = () => {
      fraction.current = selection.getSnapshot() ?? null;
    };
    const unsubscribe = selection.subscribe(take);
    take();
    return () => {
      unsubscribe();
      fraction.current = null;
    };
  }, []);
  return fraction;
};

interface TrackNotesSettingsProps {
  /** As the settings loader hands it to every page. */
  widgetId?: string;
  /** For stories and specs; the app uses the preload bridge. */
  bridge?: TrackProfileBridge;
}

/**
 * The notes of the track of the running session, or of any stored track,
 * as the editor needs them: which track the session is on, where the car is
 * and what its corners are called.
 */
const NotesTab = ({ bridge }: { bridge: TrackProfileBridge | undefined }) => {
  const profile = useTrackProfileSnapshot();
  const sessionTrackKey = profile?.trackKey ?? null;
  const sessionTrackLengthM = profile?.trackLengthM ?? 0;
  const sessionTrackName = useSessionStore(
    (state) =>
      state.session?.WeekendInfo?.TrackDisplayName ||
      state.session?.WeekendInfo?.TrackName
  );
  const { sections } = useLovelyTrackData();
  const corners = useMemo(() => trackCornersFrom(sections, 'name'), [sections]);
  const lapFraction = useLapFractionRef();

  const getSessionPositionM = useCallback(
    () =>
      lapFraction.current === null || !(sessionTrackLengthM > 0)
        ? null
        : lapFraction.current * sessionTrackLengthM,
    [lapFraction, sessionTrackLengthM]
  );

  return (
    <SettingsSection title="Notes">
      <p className="text-sm text-slate-400">
        Your own notes for a track, each written for a point on the lap. A track
        note says where you are and stays up until the next one. A pace note
        says what is coming and can be shown early. A note marked Pit is shown
        on pit road only. Changes are saved as you make them and reach the
        overlay at once.
      </p>
      <TrackNotesEditor
        bridge={bridge}
        sessionTrackKey={sessionTrackKey}
        sessionTrackName={sessionTrackName}
        getSessionPositionM={getSessionPositionM}
        corners={corners}
      />
    </SettingsSection>
  );
};

export const TrackNotesSettings = ({ bridge }: TrackNotesSettingsProps) => {
  const { currentDashboard } = useDashboard();
  const profileBridge = bridge ?? window.trackProfileBridge;

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as TrackNotesWidgetSettings | undefined;

  const [settings, setSettings] = useState<TrackNotesWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as TrackNotesWidgetSettings['config']) ??
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
          (savedSettings.config as TrackNotesWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<TrackNotesTab>(storedTab);

  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const showPaceNotes = config.showPaceNotes ?? defaultConfig.showPaceNotes;

  return (
    <BaseSettingsSection
      title="Track Notes"
      description="Your own notes for the track, shown when the car reaches the point each was written for: track notes for where you are, pace notes for what is coming. While you watch another car the notes follow that car."
      settings={settings as TrackNotesWidgetSettings}
      onSettingsChange={(s) => setSettings(s as TrackNotesWidgetSettings)}
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
              <TabButton<TrackNotesTab>
                id="notes"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                Notes
              </TabButton>
              <TabButton<TrackNotesTab>
                id="options"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                Options
              </TabButton>
              <TabButton<TrackNotesTab>
                id="visibility"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                Visibility
              </TabButton>
            </div>

            <div className="space-y-4">
              {activeTab === 'notes' && <NotesTab bridge={profileBridge} />}

              {activeTab === 'options' && (
                <>
                  <SettingsSection title="Display" scaleWidgetId={SETTING_ID}>
                    <SettingProp path="background.opacity" />
                    <SettingProp path="showPaceNotes" />
                    <SettingProp path="showTrackNotes" />
                    <SettingProp path="showComment" />
                    <SettingProp path="showNextDistance" />
                    <SettingProp path="uppercase" />
                  </SettingsSection>

                  <SettingsSection title="Timing">
                    {showPaceNotes && (
                      <>
                        <SettingProp path="paceLeadMeters" />
                        <SettingProp path="paceLeadSeconds" />
                      </>
                    )}
                    <SettingProp path="displaySeconds" />
                    <p className="text-sm text-slate-400">
                      At the wheel a note appears within a twenty-fifth of a
                      second of the car reaching it. The place of a car you are
                      watching is known to a thousandth of a lap, so its notes
                      can be 2 m early or late at Laguna Seca and 7 m at Le
                      Mans. In the garage the notes stay up however long they
                      have been shown.
                    </p>
                  </SettingsSection>

                  <SettingsSection title="Pits And Empty Tracks">
                    <SettingProp path="showPitNotes" />
                    <SettingProp path="hideWhenNoNotes" />
                  </SettingsSection>
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
