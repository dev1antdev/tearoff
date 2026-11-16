import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  TimingTowerWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'timingtower';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('timingtower');

export const TimingTowerSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as TimingTowerWidgetSettings | undefined;

  const [settings, setSettings] = useState<TimingTowerWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as TimingTowerWidgetSettings['config']) ??
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
          (savedSettings.config as TimingTowerWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('timingTowerTab') as SettingsTabType) || 'display'
  );

  useEffect(() => {
    localStorage.setItem('timingTowerTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const driverOn = config.driver?.enabled ?? defaultConfig.driver.enabled;

  return (
    <BaseSettingsSection
      title="Timing Tower"
      description="The whole field in one dense table, a row a car, with a tab for each class and one for all of them: gaps, lap times, the average of the last 5 and 10 laps, the pace of each stint against the one before, sectors, stops, energy and tyres. Made for a panel of the Pit Wall, where it scrolls under a header that stays; it can also be put on the overlay."
      settings={settings as TimingTowerWidgetSettings}
      onSettingsChange={(s) => setSettings(s as TimingTowerWidgetSettings)}
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
                id="display"
                activeTab={activeTab}
                setActiveTab={setActiveTab}
              >
                Columns
              </TabButton>
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
              {activeTab === 'display' && (
                <>
                  <SettingsSection title="Columns" scaleWidgetId={SETTING_ID}>
                    <p className="text-sm text-slate-400">
                      The columns are drawn in this order. On a panel too narrow
                      for all that are on, the tower leaves columns out rather
                      than scroll sideways, the least important first: Stops,
                      Int, Best, Sect, Tyres, Energy, Stint, Avg 10, Last, Gap,
                      Avg 5 and vs Stint. The place, the number and the driver
                      always stay.
                    </p>
                    <SettingProp path="position.enabled" />
                    <SettingProp path="carNumber.enabled" />
                    <SettingProp path="driver.enabled" />
                    {driverOn && (
                      <SettingsSection>
                        <SettingProp path="driver.nameFormat" />
                        <SettingProp path="driver.team" />
                        <SettingProp path="driver.status" />
                      </SettingsSection>
                    )}
                    <SettingProp path="gap.enabled" />
                    <SettingProp path="interval.enabled" />
                    <SettingProp path="lastTime.enabled" />
                    <SettingProp path="bestTime.enabled" />
                    <SettingProp path="avgLast5.enabled" />
                    <SettingProp path="avgLast10.enabled" />
                    <SettingProp path="stintPace.enabled" />
                    <SettingProp path="sectors.enabled" />
                    <SettingProp path="pitStops.enabled" />
                    <SettingProp path="stintLaps.enabled" />
                    <SettingProp path="energy.enabled" />
                    <SettingProp path="tyres.enabled" />
                  </SettingsSection>
                </>
              )}

              {activeTab === 'options' && (
                <>
                  <SettingsSection title="Pace">
                    <SettingProp path="averagesOver" />
                    <SettingDivider />
                    <SettingProp path="paceAgainst" />
                  </SettingsSection>

                  <SettingsSection title="Display">
                    <SettingProp path="background.opacity" />
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
