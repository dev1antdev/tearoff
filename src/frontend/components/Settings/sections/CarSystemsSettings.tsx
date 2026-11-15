import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  CarSystemsWidgetSettings,
  SIMULATOR_LABELS,
  SettingsTabType,
  carSystemIsRenamedSomewhere,
  carSystemsForSim,
  getWidgetDefaultConfig,
  type CarSystemDefinition,
} from '@irdashies/types';
import { useActiveSimulator, useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingToggleRow } from '../components/SettingToggleRow';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'carsystems';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('carsystems');

type RowsKey = 'rows' | 'lmuRows';

/**
 * Rows offered in settings: every adjustment in the catalogue, in one list
 * per simulator, each holding the entries that simulator publishes. The two
 * selections are saved apart, so choosing columns for Le Mans Ultimate leaves
 * the iRacing strip as it was.
 *
 * `dcPeakBrakeBias` used to be withheld here because it shared the brake bias
 * row, which it no longer does — it is a rear brake valve on one car and brake
 * migration on another, and never a bias split.
 */
const ROW_LISTS: readonly {
  rowsKey: RowsKey;
  title: string;
  selectable: readonly CarSystemDefinition[];
  /** iRacing's cars rename channels; LMU's dials are named by the sim. */
  renames: boolean;
}[] = [
  {
    rowsKey: 'rows',
    title: `${SIMULATOR_LABELS.iracing} Rows`,
    selectable: carSystemsForSim('iracing'),
    renames: true,
  },
  {
    rowsKey: 'lmuRows',
    title: `${SIMULATOR_LABELS.lmu} Rows`,
    selectable: carSystemsForSim('lmu'),
    renames: false,
  },
];

export const CarSystemsSettings = () => {
  const { currentDashboard } = useDashboard();
  const isLmu = useActiveSimulator() === 'lmu';

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as CarSystemsWidgetSettings | undefined;

  const [settings, setSettings] = useState<CarSystemsWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as CarSystemsWidgetSettings['config']) ??
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
          (savedSettings.config as CarSystemsWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('carSystemsTab') as SettingsTabType) || 'options'
  );

  useEffect(() => {
    localStorage.setItem('carSystemsTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  // The list for the sim that is running comes first, so its driver does not
  // scroll past the other one to reach it.
  const rowLists = isLmu ? [...ROW_LISTS].reverse() : ROW_LISTS;

  /**
   * Rows keep catalogue order rather than the order they were toggled on, so
   * the table reads the same however the user arrived at their selection.
   */
  const toggleRow = (
    rowsKey: RowsKey,
    selectable: readonly CarSystemDefinition[],
    key: string,
    enabled: boolean,
    handleConfigChange: (change: Partial<typeof settings.config>) => void
  ) => {
    const rows = settings.config[rowsKey] ?? [];
    const next = enabled
      ? selectable
          .filter(
            (adjustment) =>
              adjustment.key === key || rows.includes(adjustment.key)
          )
          .map((adjustment) => adjustment.key)
      : rows.filter((row) => row !== key);
    handleConfigChange({ [rowsKey]: next });
  };

  return (
    <BaseSettingsSection
      title="Car Systems"
      description="Brake bias, ABS, traction control and the other adjustments your car exposes."
      settings={settings as CarSystemsWidgetSettings}
      onSettingsChange={(s) => setSettings(s as CarSystemsWidgetSettings)}
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
                  <SettingsSection title="Display" scaleWidgetId={SETTING_ID}>
                    <SettingProp path="background.opacity" />
                    <SettingProp path="showUnsupportedRows" />
                    <SettingProp path="showOffRows" />
                    <SettingProp path="highlightActive" />
                    <SettingProp path="showScale" />
                    <SettingProp path="showBrakeBiasDelta" />
                  </SettingsSection>

                  <SettingsSection title="When A Dial Moves">
                    <SettingProp path="displayMode" />
                    {settings.config.displayMode === 'onChange' && (
                      <SettingProp path="changeHoldSeconds" />
                    )}
                    <SettingProp path="flashOnChange" />
                  </SettingsSection>

                  {rowLists.map(({ rowsKey, title, selectable, renames }) => (
                    <SettingsSection key={rowsKey} title={title}>
                      {selectable.map((adjustment) => (
                        <SettingToggleRow
                          key={adjustment.key}
                          title={adjustment.label}
                          // Settings configures every car at once, so rows
                          // keep their catalogue name here. Saying so matters
                          // for the ones a car renames, otherwise the driver
                          // enables "ABS" and a column headed MIGR appears.
                          description={
                            renames &&
                            carSystemIsRenamedSomewhere(adjustment.key)
                              ? 'Named differently on some cars, which control the widget follows.'
                              : undefined
                          }
                          enabled={(settings.config[rowsKey] ?? []).includes(
                            adjustment.key
                          )}
                          onToggle={(v) =>
                            toggleRow(
                              rowsKey,
                              selectable,
                              adjustment.key,
                              v,
                              handleConfigChange
                            )
                          }
                        />
                      ))}
                    </SettingsSection>
                  ))}
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
