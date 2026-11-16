import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  CrewWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'crew';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('crew');

export const CrewSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as CrewWidgetSettings | undefined;

  const [settings, setSettings] = useState<CrewWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as CrewWidgetSettings['config']) ?? defaultConfig,
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
          (savedSettings.config as CrewWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('crewTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('crewTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;

  return (
    <BaseSettingsSection
      title="Crew and Stints"
      description="Who has driven a car for how long and how fast, and every stint it has run. It is about your own car until you choose another in its header; that choice is not saved. A driver is listed once they have been at the wheel: neither simulator names an entry’s other drivers before they drive. Time at the wheel runs from the pit exit to the pit entry of each stint, and a stint that began in the garage is counted from its first crossing of the line. Each stint ends with the stop that closed it: how long the car stood still, and what can be seen to have been done. “driver” is another name at the wheel, “tyres” another compound on a wheel, “energy” or “fuel” more aboard at the line after the stop than before it. A new set of the same compound cannot be seen and is not shown. The stint under way is held against the last stint another driver drove, once it has three clean laps. Everything is the race history’s, kept from the moment the Pit Wall or this widget is switched on: what was driven before that, or while Tearoff was not running, is not counted, and the header says how many laps that is. No recording of a race with pit stops or a driver change exists, so this has been checked on staged data, not against a real race."
      settings={settings as CrewWidgetSettings}
      onSettingsChange={(s) => setSettings(s as CrewWidgetSettings)}
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
                    <SettingProp path="showDrivers" />
                    <SettingProp path="showStints" />
                  </SettingsSection>

                  <SettingsSection title="Drive Time">
                    <SettingProp path="driveTime.enabled" />
                    {config.driveTime?.enabled && (
                      <>
                        <SettingProp path="driveTime.maxMinutes" />
                        <SettingProp path="driveTime.minMinutes" />
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
