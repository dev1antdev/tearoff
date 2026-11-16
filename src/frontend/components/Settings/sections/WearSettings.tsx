import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  SettingsTabType,
  WearWidgetSettings,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'wear';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('wear');

export const WearSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as WearWidgetSettings | undefined;

  const [settings, setSettings] = useState<WearWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as WearWidgetSettings['config']) ?? defaultConfig,
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
          (savedSettings.config as WearWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('wearTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('wearTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const tyres = { ...defaultConfig.tyres, ...config.tyres };
  const brakes = { ...defaultConfig.brakes, ...config.brakes };

  return (
    <BaseSettingsSection
      title="Tyre & Brake Wear"
      description="How long your tyres and brake discs will last: the tread and the disc left on each wheel, what a lap costs and the laps that makes. Le Mans Ultimate only. The forecast is made from your own clean laps, so it has nothing to go by until the first one is driven: until then it shows what the lap under way is heading for, in italics. The sim does not say where a tyre or a disc is finished: the end of life and the failure thicknesses below are yours to set."
      settings={settings as WearWidgetSettings}
      onSettingsChange={(s) => setSettings(s as WearWidgetSettings)}
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

                  <SettingsSection title="Tyres">
                    <SettingProp path="tyres.show" />
                    {tyres.show && (
                      <>
                        <SettingProp path="showCompound" />
                        <SettingProp path="tyres.showPerLap" />
                        {tyres.showPerLap && (
                          <SettingProp path="tyres.perLapSource" />
                        )}
                        <SettingProp path="tyres.showLapsLeft" />
                        <SettingProp path="tyres.showMinutesLeft" />
                        <SettingProp path="tyres.showEndOfStint" />
                        <SettingDivider />
                        <SettingProp path="tyres.floorPct" />
                        <SettingProp path="tyres.warnPct" />
                        <SettingProp path="tyres.warnLaps" />
                        <SettingProp path="tyres.warnPerLapPct" />
                      </>
                    )}
                  </SettingsSection>

                  <SettingsSection title="Brakes">
                    <SettingProp path="brakes.show" />
                    {brakes.show && (
                      <>
                        <p className="text-sm leading-snug text-slate-400">
                          Disc thickness comes from the REST API of Le Mans
                          Ultimate, not from its shared memory. Where the API
                          does not answer the section shows dashes, and when it
                          stops answering mid-session the widget says so rather
                          than hold the last reading.
                        </p>
                        <SettingProp path="brakes.primary" />
                        <SettingProp path="brakes.showPerLap" />
                        <SettingProp path="brakes.showLapsLeft" />
                        <SettingProp path="brakes.showMinutesLeft" />
                        <SettingDivider />
                        <SettingProp path="brakes.failureFrontMm" />
                        <SettingProp path="brakes.failureRearMm" />
                        <SettingProp path="brakes.warnLifePct" />
                        <SettingProp path="brakes.warnLaps" />
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
