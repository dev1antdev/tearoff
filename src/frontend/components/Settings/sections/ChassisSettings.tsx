import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  ChassisWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'chassis';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('chassis');

export const ChassisSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as ChassisWidgetSettings | undefined;

  const [settings, setSettings] = useState<ChassisWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as ChassisWidgetSettings['config']) ??
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
          (savedSettings.config as ChassisWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('chassisTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('chassisTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const showRideHeight = config.showRideHeight ?? defaultConfig.showRideHeight;
  const showRake = config.showRake ?? defaultConfig.showRake;
  const showRoll = config.showRoll ?? defaultConfig.showRoll;
  const showToe = config.showToe ?? defaultConfig.showToe;

  return (
    <BaseSettingsSection
      title="Chassis"
      description="How your car sits on the road: ride height at the four corners with a bottoming warning, rake, front and rear roll, camber and toe. Le Mans Ultimate only."
      settings={settings as ChassisWidgetSettings}
      onSettingsChange={(s) => setSettings(s as ChassisWidgetSettings)}
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
                    <SettingProp path="layout" />
                    <SettingProp path="background.opacity" />
                  </SettingsSection>

                  <SettingsSection title="Ride Height">
                    <SettingProp path="showRideHeight" />
                    {showRideHeight && (
                      <>
                        <SettingProp path="rideHeightScale" />
                        <SettingProp path="bottomingFront" />
                        <SettingProp path="bottomingRear" />
                      </>
                    )}
                  </SettingsSection>

                  <SettingsSection title="Rake and Roll">
                    <SettingProp path="showRake" />
                    {showRake && <SettingProp path="wheelbase" />}
                    <SettingDivider />
                    <SettingProp path="showRoll" />
                    {showRoll && (
                      <>
                        <SettingProp path="trackFront" />
                        <SettingProp path="trackRear" />
                        <SettingProp path="showRollShare" />
                      </>
                    )}
                  </SettingsSection>

                  <SettingsSection title="Wheels">
                    <SettingProp path="showCamber" />
                    <SettingProp path="showToe" />
                    {showToe && <SettingProp path="toeDisplay" />}
                    <SettingProp path="showSuspension" />
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
