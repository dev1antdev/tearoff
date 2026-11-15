import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  LiftCoastWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import { ToggleSwitch } from '../components/ToggleSwitch';

const SETTING_ID = 'liftcoast';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('liftcoast');

/** Why the lock and wheelspin stages cannot be switched on yet. */
const NO_SLIP_RATIO =
  'Not available yet: it needs the slip ratio of each wheel, which Tearoff does not measure yet.';

interface UnavailableStageRowProps {
  title: string;
  description: string;
  /** The saved setting, shown as it is; it cannot be changed from here. */
  enabled: boolean;
}

/** A stage that is specified but has no data to run on yet. */
const UnavailableStageRow = ({
  title,
  description,
  enabled,
}: UnavailableStageRowProps) => (
  <div className="flex min-h-9 items-center justify-between gap-5">
    <div>
      <h4 className="text-md font-medium text-slate-400">{title}</h4>
      <p className="mt-1 text-sm text-slate-500">
        {description} {NO_SLIP_RATIO}
      </p>
    </div>
    <ToggleSwitch
      enabled={enabled}
      onToggle={() => undefined}
      disabled
      disabledReason={NO_SLIP_RATIO}
      ariaLabel={title}
    />
  </div>
);

export const LiftCoastSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as LiftCoastWidgetSettings | undefined;

  const [settings, setSettings] = useState<LiftCoastWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as LiftCoastWidgetSettings['config']) ??
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
          (savedSettings.config as LiftCoastWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('liftCoastTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('liftCoastTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const showLiftAndCoast =
    config.showLiftAndCoast ?? defaultConfig.showLiftAndCoast;

  return (
    <BaseSettingsSection
      title="Lift and Coast Lights"
      description="A strip of lights that fills as the sim's own lift-and-coast signal rises, and that traction control and ABS take over while they work. Le Mans Ultimate only. The signal has not been seen on a recording yet, so how it rises on the approach to a corner is unconfirmed."
      settings={settings as LiftCoastWidgetSettings}
      onSettingsChange={(s) => setSettings(s as LiftCoastWidgetSettings)}
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
                  <SettingsSection title="Strip" scaleWidgetId={SETTING_ID}>
                    <SettingProp path="background.opacity" />
                    <SettingProp path="ledCount" />
                    <SettingProp path="direction" />
                    <SettingProp path="mirrored" />
                  </SettingsSection>

                  <SettingsSection title="Lift And Coast">
                    <SettingProp path="showLiftAndCoast" />
                    {showLiftAndCoast && (
                      <SettingProp path="criticalFraction" />
                    )}
                  </SettingsSection>

                  <SettingsSection title="Assists">
                    <SettingProp path="showAbs" />
                    <SettingProp path="showTc" />
                    <SettingDivider />
                    <UnavailableStageRow
                      title="Wheel Lock"
                      description="The whole strip turns red while a wheel is locked."
                      enabled={config.showWheelLock ?? false}
                    />
                    <UnavailableStageRow
                      title="Wheelspin"
                      description="The whole strip turns orange while a wheel spins."
                      enabled={config.showWheelSlip ?? false}
                    />
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
                  <SettingProp path="hideWhenDark" />
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
