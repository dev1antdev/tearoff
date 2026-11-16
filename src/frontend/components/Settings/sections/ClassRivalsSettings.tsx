import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  ClassRivalsWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'classrivals';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('classrivals');

export const ClassRivalsSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as ClassRivalsWidgetSettings | undefined;

  const [settings, setSettings] = useState<ClassRivalsWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as ClassRivalsWidgetSettings['config']) ??
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
          (savedSettings.config as ClassRivalsWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('classRivalsTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('classRivalsTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;

  return (
    <BaseSettingsSection
      title="Class Rivals"
      description="The running cars of your class in a race, in the order of their places with yours among them: the gap to each now, the stops it has made, when its last was and its next is due, the gap once both of you have made the stops you still owe, and its mean of five clean laps against yours. It is made for a panel of the Pit Wall. A rival’s remaining stops are reckoned as in Finish Projection: from its fuel or virtual energy where the sim gives it (Le Mans Ultimate offline; online a rival’s fuel is withheld), else from the longest stint it has been seen to drive, else assumed from its class or from your own car, in which case its row’s forecast is drawn fainter. The lap a stop is due is always an estimate and carries a ~. What cannot be known is not guessed at and reads --: a stop made before Tearoff began watching, a gap that hangs on a stop nobody can cost yet. No recording of a race with pit stops exists, so the stop columns have been checked on hand-built data, not against a real race."
      settings={settings as ClassRivalsWidgetSettings}
      onSettingsChange={(s) => setSettings(s as ClassRivalsWidgetSettings)}
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

                  <SettingsSection title="Cars">
                    <SettingProp path="carsAhead" />
                    <SettingProp path="carsBehind" />
                  </SettingsSection>

                  <SettingsSection title="Columns">
                    <SettingProp path="showStops" />
                    <SettingProp path="showNextStop" />
                    <SettingProp path="showNetGap" />
                    <SettingProp path="showPace" />
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
