import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  TyresWidgetSettings,
  getWidgetDefaultConfig,
  type TyresConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingNumberRow } from '../components/SettingNumberRow';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'tyres';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('tyres');

/**
 * Pressure targets are stored in kPa, the unit the sim publishes, and edited
 * in whichever unit the widget is set to draw. Kept here rather than in the
 * widget folder: a settings page may not import from a widget.
 */
const KPA_PER: Record<TyresConfig['pressureUnit'], number> = {
  psi: 6.894757,
  kpa: 1,
  bar: 100,
};
const PRESSURE_LABELS: Record<TyresConfig['pressureUnit'], string> = {
  psi: 'psi',
  kpa: 'kPa',
  bar: 'bar',
};
/** Input step and decimals that make sense in each unit. */
const PRESSURE_STEP: Record<TyresConfig['pressureUnit'], number> = {
  psi: 0.1,
  kpa: 0.5,
  bar: 0.01,
};
const PRESSURE_DECIMALS: Record<TyresConfig['pressureUnit'], number> = {
  psi: 1,
  kpa: 1,
  bar: 2,
};

const fromKpa = (kpa: number, unit: TyresConfig['pressureUnit']): number =>
  Number((kpa / KPA_PER[unit]).toFixed(PRESSURE_DECIMALS[unit]));
const toKpa = (value: number, unit: TyresConfig['pressureUnit']): number =>
  value * KPA_PER[unit];

export const TyresSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as TyresWidgetSettings | undefined;

  const [settings, setSettings] = useState<TyresWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as TyresWidgetSettings['config']) ?? defaultConfig,
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
          (savedSettings.config as TyresWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('tyresTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('tyresTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const pressureUnit = config.pressureUnit ?? defaultConfig.pressureUnit;
  const pressureTarget = {
    ...defaultConfig.pressureTarget,
    ...config.pressureTarget,
  };
  const followCompound =
    config.tyreWindow?.followCompound ??
    defaultConfig.tyreWindow.followCompound;

  return (
    <BaseSettingsSection
      title="Tyres"
      description="Tyre temperatures across the tread, pressures, tread remaining and brake temperatures for your car. Le Mans Ultimate only."
      settings={settings as TyresWidgetSettings}
      onSettingsChange={(s) => setSettings(s as TyresWidgetSettings)}
      widgetId={SETTING_ID}
    >
      {(handleConfigChange) => {
        const setPressureTarget = (
          key: 'front' | 'rear' | 'tolerance',
          value: number
        ) =>
          handleConfigChange({
            pressureTarget: {
              ...pressureTarget,
              [key]: toKpa(value, pressureUnit),
            },
          });

        return (
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
                      <SettingProp path="temperatureSource" />
                      <SettingProp path="temperatureUnit" />
                      <SettingProp path="pressureUnit" />
                      <SettingProp path="showBrakes" />
                      <SettingProp path="showWear" />
                      <SettingProp path="showCompound" />
                    </SettingsSection>

                    <SettingsSection title="Tyre Window">
                      <SettingProp path="tyreWindow.followCompound" />
                      {followCompound && (
                        <SettingProp path="tyreWindow.range" />
                      )}
                      <SettingDivider />
                      <SettingProp path="tyreWindow.min" />
                      <SettingProp path="tyreWindow.max" />
                    </SettingsSection>

                    <SettingsSection title="Brake Window">
                      <SettingProp path="brakeWindow.min" />
                      <SettingProp path="brakeWindow.max" />
                    </SettingsSection>

                    <SettingsSection title="Target Pressure">
                      <SettingProp path="pressureTarget.enabled" />
                      {pressureTarget.enabled && (
                        <>
                          <SettingNumberRow
                            title="Front Target"
                            description="The hot pressure to aim for on the front axle."
                            value={fromKpa(pressureTarget.front, pressureUnit)}
                            min={0}
                            step={PRESSURE_STEP[pressureUnit]}
                            units={PRESSURE_LABELS[pressureUnit]}
                            onChange={(value) =>
                              setPressureTarget('front', value)
                            }
                          />
                          <SettingNumberRow
                            title="Rear Target"
                            description="The hot pressure to aim for on the rear axle."
                            value={fromKpa(pressureTarget.rear, pressureUnit)}
                            min={0}
                            step={PRESSURE_STEP[pressureUnit]}
                            units={PRESSURE_LABELS[pressureUnit]}
                            onChange={(value) =>
                              setPressureTarget('rear', value)
                            }
                          />
                          <SettingNumberRow
                            title="Tolerance"
                            description="How far either side of the target still counts as on target."
                            value={fromKpa(
                              pressureTarget.tolerance,
                              pressureUnit
                            )}
                            min={0}
                            step={PRESSURE_STEP[pressureUnit]}
                            units={PRESSURE_LABELS[pressureUnit]}
                            onChange={(value) =>
                              setPressureTarget('tolerance', value)
                            }
                          />
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
        );
      }}
    </BaseSettingsSection>
  );
};
