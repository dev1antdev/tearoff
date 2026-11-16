import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  TrafficWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'traffic';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('traffic');

export const TrafficSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as TrafficWidgetSettings | undefined;

  const [settings, setSettings] = useState<TrafficWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as TrafficWidgetSettings['config']) ??
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
          (savedSettings.config as TrafficWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('trafficTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('trafficTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const showMirror = config.showMirror ?? defaultConfig.showMirror;
  const showForecast = config.showForecast ?? defaultConfig.showForecast;
  const showPitExit = config.showPitExit ?? defaultConfig.showPitExit;
  const showTable =
    (config.showSlowerAhead ?? true) ||
    (config.showLeader ?? true) ||
    (config.showFasterBehind ?? true);

  return (
    <BaseSettingsSection
      title="Traffic"
      description="Who is coming, and when. The cars closing from behind with a forecast of when and where the next one arrives, laps until you meet the car ahead, the leader and the car behind, and who you come out among when you leave the pits."
      settings={settings as TrafficWidgetSettings}
      onSettingsChange={(s) => setSettings(s as TrafficWidgetSettings)}
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
                    <SettingProp path="label" />
                  </SettingsSection>

                  <SettingsSection title="Cars Behind">
                    <SettingProp path="showMirror" />
                    {showMirror && (
                      <>
                        <SettingProp path="mirrorRows" />
                        <SettingProp path="showRival" />
                        <SettingProp path="showClosingRate" />
                      </>
                    )}
                    <SettingProp path="showForecast" />
                    {showForecast && <SettingProp path="cornerLabel" />}
                  </SettingsSection>

                  <SettingsSection title="Laps To Contact">
                    <SettingProp path="showSlowerAhead" />
                    <SettingProp path="showLeader" />
                    <SettingProp path="showFasterBehind" />
                    {showTable && (
                      <>
                        <SettingProp path="maxLaps" />
                        <SettingProp path="highlightThisLap" />
                      </>
                    )}
                  </SettingsSection>

                  <SettingsSection title="Pit Exit And Rejoin">
                    <SettingProp path="showPitExit" />
                    {showPitExit && (
                      <>
                        <SettingProp path="showWhenSlow" />
                        <SettingProp path="aheadWindow" />
                        <SettingProp path="behindWindow" />
                        <SettingProp path="behindCount" />
                        <SettingProp path="careGap" />
                        <SettingProp path="dangerGap" />
                        <SettingProp path="exitHold" />
                      </>
                    )}
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
                  <SettingProp path="showOutsideRace" />
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
