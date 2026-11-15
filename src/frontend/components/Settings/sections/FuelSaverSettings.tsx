import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  FuelSaverWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'fuelsaver';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('fuelsaver');

export const FuelSaverSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as FuelSaverWidgetSettings | undefined;

  const [settings, setSettings] = useState<FuelSaverWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as FuelSaverWidgetSettings['config']) ??
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
          (savedSettings.config as FuelSaverWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('fuelSaverTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('fuelSaverTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const basis = config.basis ?? defaultConfig.basis;

  return (
    <BaseSettingsSection
      title="Fuel Saver"
      description="What a lap may cost for the fuel or the energy to last longer: a column for the laps it lasts now and one for each lap more, each with the consumption that makes it and how far above it you are running. In a race that still needs a stop, a line under them says what it would take to make one stop fewer. Virtual energy is counted in percent for a Le Mans Ultimate car that runs on it, fuel in litres or gallons otherwise, the same figures the Fuel Calculator shows. Green is already inside the target, amber is within reach, grey is not. The stop line has been checked by arithmetic only: no recorded race is long enough to need two stops."
      settings={settings as FuelSaverWidgetSettings}
      onSettingsChange={(s) => setSettings(s as FuelSaverWidgetSettings)}
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

                  <SettingsSection title="Consumption">
                    <SettingProp path="basis" />
                    {basis === 'average' && <SettingProp path="averageLaps" />}
                    <SettingProp path="reserve" />
                    <SettingProp path="pitEntryAllowance" />
                    <SettingProp path="showLast" />
                  </SettingsSection>

                  <SettingsSection title="Targets">
                    <SettingProp path="moreLaps" />
                    <SettingProp path="fewerLaps" />
                    <SettingProp path="reachShare" />
                    <SettingDivider />
                    <SettingProp path="showStopTarget" />
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
