import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  FlagPanelWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'flagpanel';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('flagpanel');

export const FlagPanelSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as FlagPanelWidgetSettings | undefined;

  const [settings, setSettings] = useState<FlagPanelWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as FlagPanelWidgetSettings['config']) ??
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
          (savedSettings.config as FlagPanelWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('flagPanelTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('flagPanelTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const blueName = config.blueName ?? defaultConfig.blueName;

  return (
    <BaseSettingsSection
      title="Flag Panel"
      description="Names the flag that applies to you and explains it in one line. Under a blue flag it shows the car coming to lap you: its number, driver, class and how far behind it is."
      settings={settings as FlagPanelWidgetSettings}
      onSettingsChange={(s) => setSettings(s as FlagPanelWidgetSettings)}
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
                <>
                  <SettingsSection title="Display" scaleWidgetId={SETTING_ID}>
                    <SettingProp path="background.opacity" />
                    <SettingProp path="tintCard" />
                    <SettingProp path="showExplanation" />
                    <SettingProp path="whenClear" />
                    <SettingProp path="enableGlow" />
                    <SettingProp path="animate" />
                  </SettingsSection>

                  <SettingsSection title="Blue Flag">
                    <SettingProp path="blueName" />
                    {blueName === 'driver' && (
                      <SettingProp path="driverNameFormat" />
                    )}
                    <SettingProp path="bluePair" />
                    <SettingProp path="distanceUnit" />
                    <SettingProp path="blue.raceOnly" />
                  </SettingsSection>

                  <SettingsSection title="Yellow Flag">
                    <SettingProp path="yellow.rangeAhead" />
                    <SettingProp path="yellow.rangeBehind" />
                    <SettingProp path="yellow.nameSector" />
                    <SettingProp path="yellow.raceOnly" />
                  </SettingsSection>

                  <SettingsSection title="Other States">
                    <SettingProp path="showStartLights" />
                    <SettingProp path="showPenalty" />
                    <SettingProp path="showLastLap" />
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
