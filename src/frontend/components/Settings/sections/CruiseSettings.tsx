import { useEffect, useState } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  CruiseWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
  type CruiseCellId,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SortableList } from '../../SortableList';
import { DraggableSettingItem } from '../components/DraggableSettingItem';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingDivider } from '../components/SettingDivider';
import { SettingActionButton } from '../components/SettingActionButton';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'cruise';
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig('cruise');

const CELLS: readonly { id: CruiseCellId; label: string }[] = [
  { id: 'compass', label: 'Compass' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'odometer', label: 'Distance Driven' },
  { id: 'timeOnTrack', label: 'Time On Track' },
  { id: 'lapDistance', label: 'Distance Into Lap' },
];
const CELL_IDS: readonly string[] = CELLS.map((cell) => cell.id);

/** The saved order with anything unknown dropped and anything missing added. */
const cellOrder = (saved: readonly string[] = defaultConfig.displayOrder) => {
  const known = saved.filter((id) => CELL_IDS.includes(id));
  return [...known, ...CELL_IDS.filter((id) => !known.includes(id))];
};

export const CruiseSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as CruiseWidgetSettings | undefined;

  const [settings, setSettings] = useState<CruiseWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as CruiseWidgetSettings['config']) ??
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
          (savedSettings.config as CruiseWidgetSettings['config']) ??
          defaultConfig,
      });
    }
  }

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('cruiseTab') as SettingsTabType) || 'display'
  );

  useEffect(() => {
    localStorage.setItem('cruiseTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  const { config } = settings;
  const order = cellOrder(config.displayOrder);
  const items = order
    .map((id) => CELLS.find((cell) => cell.id === id))
    .filter((cell): cell is (typeof CELLS)[number] => cell !== undefined);

  return (
    <BaseSettingsSection
      title="Cruise"
      description="Where your car points and how far you have driven it: a compass heading, the height of the road, the distance and the time you have driven on this track in this car, and the distance into the lap. The totals count while this widget is enabled."
      settings={settings as CruiseWidgetSettings}
      onSettingsChange={(s) => setSettings(s as CruiseWidgetSettings)}
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

            <div className="space-y-4">
              {activeTab === 'display' && (
                <SettingsSection title="Display" scaleWidgetId={SETTING_ID}>
                  <h4 className="text-md font-medium text-slate-200">
                    Display Order
                  </h4>
                  <SortableList
                    items={items}
                    onReorder={(next) =>
                      handleConfigChange({
                        displayOrder: next.map((cell) => cell.id),
                      })
                    }
                    renderItem={(cell, sortableProps) => (
                      <DraggableSettingItem
                        key={cell.id}
                        label={cell.label}
                        enabled={config[cell.id]?.enabled ?? true}
                        onToggle={(enabled) =>
                          handleConfigChange({
                            [cell.id]: { ...config[cell.id], enabled },
                          })
                        }
                        sortableProps={sortableProps}
                      />
                    )}
                  />
                  <SettingActionButton
                    label="Reset to Default Order"
                    onClick={() =>
                      handleConfigChange({
                        displayOrder: [...defaultConfig.displayOrder],
                      })
                    }
                  />
                </SettingsSection>
              )}

              {activeTab === 'options' && (
                <>
                  <SettingsSection title="Options">
                    <SettingProp path="background.opacity" />
                    <SettingProp path="layout" />
                    <SettingProp path="units" />
                    <SettingProp path="compass.dial" />
                  </SettingsSection>

                  <SettingsSection title="Totals">
                    <SettingProp path="odometer.scope" />
                    <SettingProp path="timeOnTrack.scope" />
                    <p className="text-sm text-slate-400">
                      The totals are kept for each track and car and count your
                      own driving, in the pits as well. They show a dash while
                      you watch another car.
                    </p>
                  </SettingsSection>

                  <SettingsSection title="About The Readings">
                    <p className="text-sm text-slate-400">
                      Le Mans Ultimate states no north, so the compass takes the
                      track model&apos;s own +Z axis for it. Whether that agrees
                      with a map of the real circuit depends on how the track
                      was modelled.
                    </p>
                    <p className="text-sm text-slate-400">
                      Elevation is the height in the track model&apos;s own
                      coordinates, not an altitude above the sea, and can be
                      negative. iRacing states no height while the car is being
                      driven, so the elevation cell is not drawn there.
                    </p>
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
