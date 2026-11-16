import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  RaceLogWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'racelog';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('racelog');

export const RaceLogSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as RaceLogWidgetSettings | undefined;

  const [settings, setSettings] = useState<RaceLogWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as RaceLogWidgetSettings['config']) ??
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
          (savedSettings.config as RaceLogWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('raceLogTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('raceLogTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;

  return (
    <BaseSettingsSection
      title="Race Log"
      description="What happened in the race, one line an event, newest first: a car into the pits and from which place, out again after how long and with whom at the wheel, a pass down the pit lane without stopping, a driver change, each class’s fastest lap, a full-course yellow and how long it lasted, a car that has gone and come back, a penalty, our own place in class. Somebody who looks at the Pit Wall after an hour away reads it to catch up. It is made for a panel of the Pit Wall. The log is kept from the moment the Pit Wall or this widget is switched on, for the whole race, whether or not it is on screen, and is stored with the race: started again in the middle of a race, Tearoff carries the log on. What happened while Tearoff was not running, or before the log began, is not in it and is not filled in. A stop is what the race history sees from outside the car: a car standing still in the pit lane for more than a second, so what was done at the stop is not said, and a pass with no standing is listed as a pass and not as a penalty served. Penalties are listed only where the sim states them: Le Mans Ultimate’s count for each car, with its kind once the sim names it, and iRacing’s black flag. The one estimate is when the rain of a changed forecast begins, marked with ~, which is the Weather Forecast’s own estimate. The log keeps 1000 events a race, and past 900 the oldest fastest laps and changes of place go first. No recording of a race with a pit stop, a driver change, a full-course yellow or a penalty exists, so all of those have been checked on staged data, not against a real race."
      settings={settings as RaceLogWidgetSettings}
      onSettingsChange={(s) => setSettings(s as RaceLogWidgetSettings)}
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
                    <SettingProp path="time" />
                    <SettingProp path="showFilters" />
                  </SettingsSection>

                  <SettingsSection title="The List Opens With">
                    <SettingProp path="scope" />
                    <SettingProp path="kinds.pits" />
                    <SettingProp path="kinds.drivers" />
                    <SettingProp path="kinds.fastestLaps" />
                    <SettingProp path="kinds.flags" />
                    <SettingProp path="kinds.status" />
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
