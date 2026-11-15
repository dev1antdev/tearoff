import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  StintHistoryWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'stinthistory';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('stinthistory');

export const StintHistorySettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as StintHistoryWidgetSettings | undefined;

  const [settings, setSettings] = useState<StintHistoryWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as StintHistoryWidgetSettings['config']) ??
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
          (savedSettings.config as StintHistoryWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('stintHistoryTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('stintHistoryTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const showFuel = config.showFuel ?? defaultConfig.showFuel;
  const showWear = config.showWear ?? defaultConfig.showWear;
  const showBrakes = config.showBrakes ?? defaultConfig.showBrakes;
  const showPace = config.showPace ?? defaultConfig.showPace;

  return (
    <BaseSettingsSection
      title="Stint History"
      description="The stint you are driving and the ones before it, one row each: laps, time on track, fuel or virtual energy used, the tyres and what they wore, the best lap, and the stop that ended it. A stint runs from one service to the next: it ends when the car is refuelled, gets tyres or another driver, goes back to the garage, or the session ends. A drive-through ends nothing. Tearoff records every stint you drive whether or not this widget is on screen; a team-mate's stints are not listed."
      settings={settings as StintHistoryWidgetSettings}
      onSettingsChange={(s) => setSettings(s as StintHistoryWidgetSettings)}
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
                  </SettingsSection>

                  <SettingsSection title="Stints">
                    <SettingProp path="showCurrent" />
                    <SettingProp path="historyCount" />
                    <SettingProp path="minLaps" />
                    <SettingProp path="thisSessionOnly" />
                    <SettingProp path="newestFirst" />
                  </SettingsSection>

                  <SettingsSection title="Columns">
                    <SettingProp path="showLaps" />
                    <SettingProp path="showTime" />
                    <SettingProp path="showFuel" />
                    {showFuel && (
                      <SettingsSection>
                        <SettingProp path="showFuelPerLap" />
                        <SettingProp path="fuelUnits" />
                      </SettingsSection>
                    )}
                    <SettingProp path="showTyres" />
                    <SettingProp path="showWear" />
                    <SettingProp path="showBrakes" />
                    {(showWear || showBrakes) && (
                      <SettingsSection>
                        <SettingProp path="wearMode" />
                      </SettingsSection>
                    )}
                    <SettingProp path="showPace" />
                    {showPace && (
                      <SettingsSection>
                        <SettingProp path="showConsistency" />
                      </SettingsSection>
                    )}
                    <SettingProp path="showStop" />
                    <SettingProp path="showDriver" />
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
