import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  FINISH_SCENARIO_MAX_S,
  FINISH_SCENARIOS_MAX,
  FinishProjectionWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { normalizeFinishScenarios } from '@irdashies/domain/finishProjection';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingNumberListRow } from '../components/SettingNumberListRow';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'finishorder';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('finishorder');

/** Ten seconds on from the longest stop length set; half a minute to begin. */
const nextScenario = (scenarios: readonly number[]): number =>
  scenarios.length === 0 ? 30 : Math.max(...scenarios) + 10;

export const FinishProjectionSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as FinishProjectionWidgetSettings | undefined;

  const [settings, setSettings] = useState<FinishProjectionWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as FinishProjectionWidgetSettings['config']) ??
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
          (savedSettings.config as FinishProjectionWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('finishProjectionTab') as SettingsTabType) ||
      'options'
  );

  useEffect(() => {
    localStorage.setItem('finishProjectionTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const scenarios = normalizeFinishScenarios(
    config.scenarios,
    defaultConfig.scenarios
  );
  const showExtraRefuel =
    config.showExtraRefuel ?? defaultConfig.showExtraRefuel;
  const showRivals = config.showRivals ?? defaultConfig.showRivals;

  return (
    <BaseSettingsSection
      title="Finish Projection"
      description="Where the race ends, and what that asks of your car. The table has a column for no stop and one for each stop length you set: how long after the clock the leader takes the flag, the laps you still have to cover, and what has to go in for them. A timed race ends when the leader next crosses the line after the clock runs out, so a few seconds either way can add or drop a lap: a finish that close to a line is amber, with an arrow up when a little quicker means one lap more and an arrow down when a little slower means one lap fewer. Under the table are the class cars around you, with the gap now, the stops each of you still owes and the gap once they are made. A rival's stops are reckoned from its fuel or virtual energy where the sim gives it (Le Mans Ultimate offline; online a rival's fuel is withheld), else from the longest stint it has been seen to drive, else assumed from its class or from your own car, which is marked with a ~ and drawn fainter. What cannot be known is not guessed at: how much a rival takes on at a stop, its tyre and driver changes, penalties still to be served and neutralisations. No recording of a race with pit stops exists yet, so the stop columns and the rivals' stops have been checked on hand-built data and by arithmetic, not against a real strategy."
      settings={settings as FinishProjectionWidgetSettings}
      onSettingsChange={(s) => setSettings(s as FinishProjectionWidgetSettings)}
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

                  <SettingsSection title="Stop Columns">
                    <SettingNumberListRow
                      title="Stop Lengths"
                      description={`Time lost in the pits against staying out, one column each: up to ${FINISH_SCENARIOS_MAX}, each 0 to ${FINISH_SCENARIO_MAX_S} s.`}
                      values={scenarios}
                      min={0}
                      max={FINISH_SCENARIO_MAX_S}
                      step={5}
                      units="s"
                      maxItems={FINISH_SCENARIOS_MAX}
                      nextValue={nextScenario}
                      onChange={(next) =>
                        handleConfigChange({ scenarios: next })
                      }
                    />
                    <SettingProp path="leaderStops" />
                    <SettingDivider />
                    <SettingProp path="showPlanned" />
                    <SettingProp path="showToFinish" />
                    <SettingProp path="showLast" />
                    <SettingProp path="extraTime" />
                  </SettingsSection>

                  <SettingsSection title="Finish">
                    <SettingProp path="nearRange" />
                    <SettingProp path="showLapFractions" />
                  </SettingsSection>

                  <SettingsSection title="Refuel">
                    <SettingProp path="refuelDisplay" />
                    <SettingProp path="showExtraRefuel" />
                    {showExtraRefuel && <SettingProp path="extraLaps" />}
                  </SettingsSection>

                  <SettingsSection title="Class Rivals">
                    <SettingProp path="showRivals" />
                    {showRivals && (
                      <>
                        <SettingProp path="rivalsAhead" />
                        <SettingProp path="rivalsBehind" />
                        <SettingProp path="includePace" />
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
