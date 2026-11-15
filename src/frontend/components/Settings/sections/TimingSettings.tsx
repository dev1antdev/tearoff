import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  TimingWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'timing';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('timing');

export const TimingSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as TimingWidgetSettings | undefined;

  const [settings, setSettings] = useState<TimingWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as TimingWidgetSettings['config']) ??
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
          (savedSettings.config as TimingWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('timingTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('timingTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const tiles = { ...defaultConfig.tiles, ...config.tiles };
  const usesReference = tiles.delta || tiles.predictedLap;
  const showsLapTimes =
    tiles.lastLap ||
    tiles.bestLap ||
    tiles.predictedLap ||
    tiles.sessionBest ||
    tiles.allTimeBest ||
    tiles.pace;

  return (
    <BaseSettingsSection
      title="Timing"
      description="The lap in one glance: the lap you are on, the delta to a reference lap, your last and best laps and your sector times, with more timing figures as optional rows."
      settings={settings as TimingWidgetSettings}
      onSettingsChange={(s) => setSettings(s as TimingWidgetSettings)}
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

            <div>
              {activeTab === 'options' && (
                <div className="space-y-4">
                  <SettingsSection title="Tiles">
                    <SettingProp path="tiles.lap" />
                    <SettingProp path="tiles.delta" />
                    <SettingProp path="tiles.lastLap" />
                    <SettingProp path="tiles.bestLap" />
                    <SettingProp path="tiles.sectors" />
                  </SettingsSection>

                  {/*
                    The stint best has no switch here yet, and the reference
                    below offers two laps of the four the setting can hold:
                    the stint best and the last lap both arrive with the
                    extended lap delta, and until then could only show dashes.
                  */}
                  <SettingsSection title="More Tiles">
                    <SettingProp path="tiles.currentLap" />
                    <SettingProp path="tiles.predictedLap" />
                    <SettingDivider />
                    <SettingProp path="tiles.sessionBest" />
                    <SettingProp path="tiles.allTimeBest" />
                    <SettingDivider />
                    <SettingProp path="tiles.pace" />
                  </SettingsSection>

                  <SettingsSection title="Laps">
                    {usesReference && <SettingProp path="deltaReference" />}
                    {tiles.delta && <SettingProp path="deltaDecimals" />}
                    {showsLapTimes && <SettingProp path="lapTimeDecimals" />}
                    <SettingProp path="sessionBestScope" />
                  </SettingsSection>

                  {tiles.sectors && (
                    <SettingsSection title="Sectors">
                      <SettingProp path="sectorSource" />
                      <SettingProp path="sectorIncidents" />
                      <SettingProp path="sectorDecimals" />
                      <SettingProp path="sectorTilesMax" />
                    </SettingsSection>
                  )}

                  <SettingsSection title="Display" scaleWidgetId={SETTING_ID}>
                    <SettingProp path="background.opacity" />
                    <SettingProp path="scale" />
                  </SettingsSection>
                </div>
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
