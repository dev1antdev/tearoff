import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  OurCarWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'ourcar';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('ourcar');

export const OurCarSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as OurCarWidgetSettings | undefined;

  const [settings, setSettings] = useState<OurCarWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as OurCarWidgetSettings['config']) ??
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
          (savedSettings.config as OurCarWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('ourCarTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('ourCarTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;

  return (
    <BaseSettingsSection
      title="Our Car"
      description="Your own entry in a race, as the pit wall wants it: what is aboard and how many laps and minutes it lasts, the pit window, the stops still to make and what the next costs, where the car is forecast to finish in its class, and where it comes out after its stop. It is made for a panel of the Pit Wall and stays up while a team-mate drives. The forecast assumes everything goes on as it has: every car of the class keeps its measured pace and makes the stops it still owes, each at the cost reckoned for it, which is the same reckoning Finish Projection shows, over the whole class and without that widget’s extra time. It knows nothing of a full-course yellow, a penalty still to serve, a tyre or driver change, or how much a rival takes on. A figure with a ~ is an estimate; a figure that cannot be known reads --. Under Le Mans Ultimate the game stops sending the car’s fuel in litres, its tyre wear and its damage while a team-mate drives, and the panel says so; virtual energy is still sent. No recording of a race with pit stops exists yet, so everything about a stop has been checked on hand-built data, not against a real race."
      settings={settings as OurCarWidgetSettings}
      onSettingsChange={(s) => setSettings(s as OurCarWidgetSettings)}
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
                    <SettingProp path="fuelUnits" />
                  </SettingsSection>

                  <SettingsSection title="Strategy">
                    <SettingProp path="showStops" />
                    <SettingProp path="showForecast" />
                    <SettingProp path="showRejoin" />
                  </SettingsSection>

                  <SettingsSection title="The Car">
                    <SettingProp path="showPace" />
                    <SettingProp path="showTyres" />
                    <SettingProp path="showDamage" />
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
