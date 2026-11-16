import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  CarLapsWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'carlaps';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('carlaps');

export const CarLapsSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as CarLapsWidgetSettings | undefined;

  const [settings, setSettings] = useState<CarLapsWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as CarLapsWidgetSettings['config']) ??
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
          (savedSettings.config as CarLapsWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('carLapsTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('carLapsTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;

  return (
    <BaseSettingsSection
      title="Car Laps"
      description="The laps of one car, newest first: the time the sim gave each, its sectors, what it used, and a note. It is about your own car until you choose another in its header; that choice is not saved. The best clean lap of each stint is green, once the stint has two, and purple where it is also the best lap of the car’s class. A lap that is not a clean one is written quieter. A note says what the lap’s own flags and the car’s stints show: an in lap, an out lap, a pass through the pit lane, the stop with how long the car stood and what can be seen to have been done, a driver change with no stop, the lap from the grid, a yellow, a full-course yellow, and a lap the sim gave no time. Why a lap was slow is not recorded and is not guessed at. Laps the car completed while nothing was recording are one quiet line where they would have been. Everything is the race history’s, kept from the moment the Pit Wall or this widget is switched on. No recording of a race with pit stops or a driver change exists, so the notes about them have been checked on staged data, not against a real race."
      settings={settings as CarLapsWidgetSettings}
      onSettingsChange={(s) => setSettings(s as CarLapsWidgetSettings)}
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

                  <SettingsSection title="Columns">
                    <SettingProp path="showSectors" />
                    <SettingProp path="showEnergy" />
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
