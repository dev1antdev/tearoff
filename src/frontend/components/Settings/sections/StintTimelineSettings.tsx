import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  StintTimelineWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'stinttimeline';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('stinttimeline');

export const StintTimelineSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as StintTimelineWidgetSettings | undefined;

  const [settings, setSettings] = useState<StintTimelineWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as StintTimelineWidgetSettings['config']) ??
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
          (savedSettings.config as StintTimelineWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('stintTimelineTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('stintTimelineTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;

  return (
    <BaseSettingsSection
      title="Stint Timeline"
      description="Your car and a few class rivals as bars from the start of a race to the flag. The stints each car has driven are filled, with a break at every stop; the stints to come are dashed; a white line is now. Your own car’s bars are coloured and named by driver, and a rival’s change shade at each driver change. It is made for a panel of the Pit Wall. The driven stints are the race history’s records, kept from the moment the Pit Wall or this widget is switched on: a stint driven before that, or while Tearoff was not running, is a gap in the bar and is not filled in. The stints to come are the forecast’s: the lap each car’s next stop is due, then a full stint and a stop at a time for as many stops as it owes, the last one running to the flag. Where the forecast cannot say when a car stops there are no dashed bars at all, since an unbroken one would say it does not stop. Who drives a stint to come is not known and is not shown. The scale is hours of the session clock, or laps for a race run to a lap count. No recording of a race with pit stops or a driver change exists, so this has been checked on staged data, not against a real race."
      settings={settings as StintTimelineWidgetSettings}
      onSettingsChange={(s) => setSettings(s as StintTimelineWidgetSettings)}
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
                    <SettingProp path="showLegend" />
                  </SettingsSection>

                  <SettingsSection title="Bars">
                    <SettingProp path="rivals" />
                    <SettingProp path="showDrivers" />
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
