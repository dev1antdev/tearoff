import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  DamageWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'damage';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('damage');

export const DamageSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as DamageWidgetSettings | undefined;

  const [settings, setSettings] = useState<DamageWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as DamageWidgetSettings['config']) ??
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
          (savedSettings.config as DamageWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('damageTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('damageTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const diagramEnabled =
    config.diagram?.enabled ?? defaultConfig.diagram.enabled;
  const reading = config.diagram?.reading ?? defaultConfig.diagram.reading;
  const statsEnabled = config.stats?.enabled ?? defaultConfig.stats.enabled;

  return (
    <BaseSettingsSection
      title="Damage"
      description="Your car from above: where the body is dented, what has come off or gone flat, where it was last hit, and what a repair adds to the next stop. Le Mans Ultimate only. Only a dent at the nose has been seen in a recorded session: the other seven zones, heavy dents, a lost wing or wheel, a flat tyre, suspension damage and the overheating warning follow how the sim is understood to report them and are untested."
      settings={settings as DamageWidgetSettings}
      onSettingsChange={(s) => setSettings(s as DamageWidgetSettings)}
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

                  <SettingsSection title="Car Diagram">
                    <SettingProp path="diagram.enabled" />
                    {diagramEnabled && (
                      <>
                        <SettingProp path="diagram.reading" />
                        {reading !== 'none' && (
                          <SettingProp path="diagram.showDamage" />
                        )}
                        <SettingDivider />
                        <SettingProp path="impact.enabled" />
                        <SettingProp path="flashDetached" />
                        <SettingProp path="overheating.enabled" />
                      </>
                    )}
                  </SettingsSection>

                  <SettingsSection title="Figures">
                    <SettingProp path="stats.enabled" />
                    {statsEnabled && (
                      <>
                        <SettingProp path="stats.aeroWarn" />
                        <SettingProp path="stats.bodyWarn" />
                        <SettingProp path="stats.suspensionWarn" />
                        <SettingProp path="stats.tyreWarn" />
                      </>
                    )}
                  </SettingsSection>

                  <SettingsSection title="Repair">
                    <SettingProp path="repair.enabled" />
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
                  <SettingProp path="hideWhenUndamaged" />
                </SettingsSection>
              )}
            </div>
          </div>
        </SettingProps>
      )}
    </BaseSettingsSection>
  );
};
