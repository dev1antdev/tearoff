import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  PitStopWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'pitstop';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('pitstop');

export const PitStopSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as PitStopWidgetSettings | undefined;

  const [settings, setSettings] = useState<PitStopWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as PitStopWidgetSettings['config']) ??
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
          (savedSettings.config as PitStopWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('pitStopTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('pitStopTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const showRefuel = config.showRefuel ?? defaultConfig.showRefuel;
  const showRejoin = config.showRejoin ?? defaultConfig.showRejoin;

  return (
    <BaseSettingsSection
      title="Pit Stop"
      description="How long the next stop will stand and what it is made of, what the visit costs against staying out, where you rejoin, and a countdown once you are in the pit lane. The pit lane is learned per track: its two lines from the first car seen crossing them, its speed limit off your limiter, and its drive time from your own stops. Until then a figure that is reckoned is written with a ~. Under Le Mans Ultimate the stop is the sim's own estimate; under iRacing it is learned from your earlier stops here. No recording of a stop exists yet, so the countdown, the measured lane time and how the sim adds tyres, repairs and a driver change into a total follow how the sim is understood to work and are untested in a real stop."
      settings={settings as PitStopWidgetSettings}
      onSettingsChange={(s) => setSettings(s as PitStopWidgetSettings)}
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

                  <SettingsSection title="The Stop">
                    <SettingProp path="extraTime" />
                    <SettingProp path="longStopThreshold" />
                    <SettingProp path="showBreakdown" />
                    <SettingProp path="resultHold" />
                  </SettingsSection>

                  <SettingsSection title="Refuel">
                    <SettingProp path="showRefuel" />
                    {showRefuel && <SettingProp path="showRunLength" />}
                  </SettingsSection>

                  <SettingsSection title="Rejoin">
                    <SettingProp path="showRejoin" />
                    {showRejoin && <SettingProp path="rejoinScope" />}
                    <SettingDivider />
                    <SettingProp path="showOccupancy" />
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
                  <SettingProp path="showMode" />
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
