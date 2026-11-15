import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  WeatherForecastWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'weatherforecast';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('weatherforecast');

export const WeatherForecastSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as WeatherForecastWidgetSettings | undefined;

  const [settings, setSettings] = useState<WeatherForecastWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as WeatherForecastWidgetSettings['config']) ??
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
          (savedSettings.config as WeatherForecastWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('weatherForecastTab') as SettingsTabType) ||
      'options'
  );

  useEffect(() => {
    localStorage.setItem('weatherForecastTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const showRain =
    config.rainChance?.enabled ?? defaultConfig.rainChance.enabled;

  return (
    <BaseSettingsSection
      title="Weather Forecast"
      description="The weather now and the forecast for the rest of the session: sky, air temperature and chance of rain at each coming point. Le Mans Ultimate only."
      settings={settings as WeatherForecastWidgetSettings}
      onSettingsChange={(s) => setSettings(s as WeatherForecastWidgetSettings)}
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
                    <SettingProp path="nodes" />
                    <SettingProp path="showNow" />
                    <SettingProp path="reverse" />
                    <SettingProp path="hideEmptyColumns" />
                    <SettingProp path="units" />
                  </SettingsSection>

                  <SettingsSection title="When A Point Starts">
                    <SettingProp path="timeLabel" />
                    <p className="text-sm text-slate-400">
                      Le Mans Ultimate publishes what each of its five forecast
                      points holds, and not when it applies. Tearoff places them
                      a fifth of the session apart, starting when the session
                      clock does. In a race that is a fifth of the race&apos;s
                      own length, which was measured on one recording of a dry
                      race in real time. In practice and qualifying it is a
                      fifth of the session, which is assumed. A session whose
                      weather changes, and one with a time scale above 1, have
                      not been seen, so every time is written with a ~. In a
                      race that ends on laps there is no time to show; the
                      points stay in order and drop out as the leader covers
                      each fifth of the laps.
                    </p>
                  </SettingsSection>

                  <SettingsSection title="Rows">
                    <SettingProp path="temperature.enabled" />
                    <SettingProp path="rainChance.enabled" />
                    {showRain && <SettingProp path="rainChance.showValue" />}
                    <SettingProp path="trend.enabled" />
                    <SettingDivider />
                    <SettingProp path="humidity.enabled" />
                    <SettingProp path="wind.enabled" />
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
