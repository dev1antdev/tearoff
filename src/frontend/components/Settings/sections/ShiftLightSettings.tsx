import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  ShiftLightWidgetSettings,
  getWidgetDefaultConfig,
  SettingsTabType,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { TabButton } from '../components/TabButton';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import { CustomShiftPointsSection } from '../components/CustomShiftPointsSection';

const SETTING_ID = 'shiftlight';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('shiftlight');

export const ShiftLightSettings = () => {
  const { currentDashboard } = useDashboard();
  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as ShiftLightWidgetSettings | undefined;
  const [settings, setSettings] = useState<ShiftLightWidgetSettings>({
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as ShiftLightWidgetSettings['config']) ??
      defaultConfig,
  });

  // Tab state with persistence
  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('shiftlightTab') as SettingsTabType) || 'display'
  );

  useEffect(() => {
    localStorage.setItem('shiftlightTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) {
    return <>Loading...</>;
  }

  return (
    <BaseSettingsSection
      title="Shift Light"
      description="Configure the Shift Light. Hint: enable 'Show RPM Text' to see where the box is."
      settings={settings}
      onSettingsChange={setSettings}
      widgetId="shiftlight"
    >
      {(handleConfigChange) => {
        const config = settings.config;

        return (
          <SettingProps
            widget={SETTING_ID}
            config={settings.config}
            onChange={handleConfigChange}
          >
            <div className="space-y-6">
              {/* Tabs */}
              <div className="flex flex-wrap gap-1 border-b border-slate-700 pb-1">
                <TabButton
                  id="display"
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                >
                  Display
                </TabButton>
                <TabButton
                  id="options"
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                >
                  Custom Shift Points
                </TabButton>
                <TabButton
                  id="visibility"
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                >
                  Visibility
                </TabButton>
              </div>

              {/* DISPLAY TAB */}
              {activeTab === 'display' && (
                <>
                  <SettingsSection title="Display" scaleWidgetId="shiftlight">
                    <SettingProp path="background.opacity" />

                    <SettingProp path="showRpmText" />
                  </SettingsSection>
                </>
              )}

              {/* OPTIONS TAB */}
              {activeTab === 'options' && (
                <SettingsSection title="Custom Shift Points">
                  <CustomShiftPointsSection
                    settings={config.shiftPointSettings}
                    onChange={(shiftPointSettings) =>
                      handleConfigChange({ shiftPointSettings })
                    }
                    description="If enabled, custom shift points will be displayed"
                  />
                </SettingsSection>
              )}

              {/* VISIBILITY TAB */}
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
          </SettingProps>
        );
      }}
    </BaseSettingsSection>
  );
};
