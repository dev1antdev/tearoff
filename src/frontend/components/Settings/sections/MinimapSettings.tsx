import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  MinimapWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'minimap';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('minimap');

export const MinimapSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as MinimapWidgetSettings | undefined;

  const [settings, setSettings] = useState<MinimapWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as MinimapWidgetSettings['config']) ??
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
          (savedSettings.config as MinimapWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('minimapTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('minimapTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  return (
    <BaseSettingsSection
      title="Minimap"
      description="A close-range map of the track around your car, with the cars near you."
      settings={settings as MinimapWidgetSettings}
      onSettingsChange={(s) => setSettings(s as MinimapWidgetSettings)}
      widgetId={SETTING_ID}
    >
      {(handleConfigChange) => (
        <SettingProps
          widget={SETTING_ID}
          config={settings.config}
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
                  <SettingsSection title="Map" scaleWidgetId={SETTING_ID}>
                    <SettingProp path="range" />
                    <SettingProp path="orientation" />
                    <SettingProp path="trackWidth" />
                    <SettingProp path="showStartFinish" />
                    <SettingProp path="background.opacity" />
                  </SettingsSection>

                  <SettingsSection title="Cars">
                    <SettingProp path="label" />
                    <SettingProp path="markerSize" />
                    <SettingProp path="useClassColors" />
                    <SettingProp path="dimCarsInPits" />
                  </SettingsSection>
                </>
              )}

              {activeTab === 'visibility' && (
                <SettingsSection title="Session Visibility">
                  <SessionVisibility
                    sessionVisibility={settings.config.sessionVisibility}
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
