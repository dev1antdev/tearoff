import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  HybridWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'hybrid';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('hybrid');

export const HybridSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as HybridWidgetSettings | undefined;

  const [settings, setSettings] = useState<HybridWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as HybridWidgetSettings['config']) ??
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
          (savedSettings.config as HybridWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('hybridTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('hybridTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const showLapUse = config.showLapUse ?? defaultConfig.showLapUse;
  const showMotor = config.showMotor ?? defaultConfig.showMotor;
  const showTemps = config.motor?.showTemps ?? defaultConfig.motor.showTemps;
  const showPower =
    (config.motor?.showPower ?? defaultConfig.motor.showPower) ||
    (config.motor?.showRegen ?? defaultConfig.motor.showRegen);

  return (
    <BaseSettingsSection
      title="Hybrid"
      description="The hybrid battery of your car: its charge, whether the motor is deploying or regenerating, what this lap has used and recovered, and optionally the motor's own readings. Le Mans Ultimate only, and drawn only for a car that has the system. None of it has been checked against a recording of a hybrid car yet: the motor states are read as TinyPedal reads them, and the units of the motor row are unconfirmed."
      settings={settings as HybridWidgetSettings}
      onSettingsChange={(s) => setSettings(s as HybridWidgetSettings)}
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
                    <SettingProp path="decimals" />
                  </SettingsSection>

                  <SettingsSection title="Charge">
                    <SettingProp path="lowChargePct" />
                    <SettingProp path="highChargePct" />
                    <SettingProp path="warningFlash" />
                  </SettingsSection>

                  <SettingsSection title="This Lap">
                    <SettingProp path="showLapUse" />
                    {showLapUse && <SettingProp path="freezeSeconds" />}
                    <SettingProp path="showNetEstimate" />
                    <SettingProp path="showDeployTimer" />
                  </SettingsSection>

                  <SettingsSection title="Motor">
                    <SettingProp path="showMotor" />
                    {showMotor && (
                      <>
                        <SettingDivider />
                        <SettingProp path="motor.showTemps" />
                        {showTemps && (
                          <>
                            <SettingProp path="motorTempWarnC" />
                            <SettingProp path="coolantTempWarnC" />
                            <SettingProp path="temperatureUnit" />
                          </>
                        )}
                        <SettingDivider />
                        <SettingProp path="motor.showRpm" />
                        <SettingProp path="motor.showTorque" />
                        <SettingProp path="motor.showPower" />
                        <SettingProp path="motor.showRegen" />
                        {showPower && <SettingProp path="powerUnit" />}
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
