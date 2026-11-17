import { useEffect, useId, useState } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  RaceChartsWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import {
  RACE_CHART_MAX_RIVALS,
  parseCarNumbers,
} from '@irdashies/domain/raceHistory/chartRivals';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'racecharts';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('racecharts');

interface CarNumbersRowProps {
  value: string;
  onChange: (value: string) => void;
}

/** The car numbers to draw, typed as a list. */
const CarNumbersRow = ({ value, onChange }: CarNumbersRowProps) => {
  const id = useId();
  const numbers = parseCarNumbers(value);
  return (
    <div className="flex min-h-9 flex-wrap items-start justify-between gap-x-5 gap-y-2">
      <div className="min-w-0 flex-1 basis-40">
        <label htmlFor={id} className="text-md font-medium text-slate-300">
          Car Numbers
        </label>
        <p id={`${id}-help`} className="mt-1 text-sm text-slate-500">
          Up to {RACE_CHART_MAX_RIVALS} car numbers, separated by commas or
          spaces. A number no car of the session carries is left out, and so is
          your own.{' '}
          <span data-testid="race-charts-numbers-read">
            {numbers.length > 0
              ? `Read as ${numbers.map((number) => `#${number}`).join(', ')}.`
              : 'None entered yet.'}
          </span>
        </p>
      </div>
      <input
        id={id}
        type="text"
        aria-describedby={`${id}-help`}
        value={value}
        placeholder="e.g. 46, 91"
        onChange={(event) => onChange(event.target.value)}
        className="settings-field w-44"
      />
    </div>
  );
};

export const RaceChartsSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as RaceChartsWidgetSettings | undefined;

  const [settings, setSettings] = useState<RaceChartsWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as RaceChartsWidgetSettings['config']) ??
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
          (savedSettings.config as RaceChartsWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('raceChartsTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('raceChartsTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;

  return (
    <BaseSettingsSection
      title="Race Charts"
      description="Your car’s race lap by lap, one chart at a time. Pace is its lap times, the line in the colour of whoever drove, with up to three other cars as thinner lines. The scale is fitted to the clean laps on the chart, so that a lap in the pits, the lap from the grid or a lap under a full-course yellow does not flatten the rest: a lap that does not fit is a mark at the edge it is past, and pointing at it gives its real time. Slower is up. Gap is each of those cars against yours at the line: the time between your crossing that ended a lap and theirs that ended the lap of the same number, above the line for a car ahead and below it for one behind. It is counted lap number for lap number, so a car a lap down reads a whole lap’s time behind, not the few seconds it may be from you on the road. Usage is what each lap of your car took of what it runs on, in percent of a full budget: virtual energy for a car that runs on it, fuel otherwise. Le Mans Ultimate only: iRacing publishes neither, and the chart is not offered there. A line breaks at every stop and wherever a lap is not held; your stops are bands behind the lines, and laps driven while nothing was recording are a hatched band. Point at a lap, or step through the laps with the arrow keys, for every car’s figure on it and who drove. Everything is the race history’s, kept from the moment the Pit Wall or this widget is switched on. No recording of a race with pit stops, a driver change or a full-course yellow exists, so all of this has been checked on staged data, not against a real race."
      settings={settings as RaceChartsWidgetSettings}
      onSettingsChange={(s) => setSettings(s as RaceChartsWidgetSettings)}
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

                  <SettingsSection title="Chart">
                    <SettingProp path="tab" />
                    <SettingProp path="laps" />
                  </SettingsSection>

                  <SettingsSection title="Other Cars">
                    <SettingProp path="others" />
                    {config.others === 'chosen' && (
                      <CarNumbersRow
                        value={config.carNumbers}
                        onChange={(carNumbers) =>
                          handleConfigChange({ carNumbers })
                        }
                      />
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
