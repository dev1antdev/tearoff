import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  BattleWidgetSettings,
  SettingsTabType,
  getWidgetDefaultConfig,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { TabButton } from '../components/TabButton';
import { SortableList } from '../../SortableList';
import { DraggableSettingItem } from '../components/DraggableSettingItem';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingDivider } from '../components/SettingDivider';
import { SettingsSection } from '../components/SettingSection';
import { SettingProps, settingPropFor } from '../components/SettingProp';

const SETTING_ID = 'battle';
const SettingProp = settingPropFor(SETTING_ID);

type BattleConfigShape = BattleWidgetSettings['config'];

/** The columns of the box: every config key that is a column to switch. */
type ColumnKey =
  | 'position'
  | 'positionChange'
  | 'carNumber'
  | 'driverName'
  | 'status'
  | 'compound'
  | 'stint'
  | 'pitStops'
  | 'energy'
  | 'energyUse'
  | 'bestTime'
  | 'lastTime'
  | 'speed'
  | 'trackLimits'
  | 'gap'
  | 'forecast';

interface SortableSetting {
  id: ColumnKey;
  label: string;
  /** What the column shows, where its name does not say. */
  description?: string;
}

const sortableSettings: SortableSetting[] = [
  { id: 'position', label: 'Position' },
  {
    id: 'positionChange',
    label: 'Position Change',
    description: 'Places gained or lost against the class grid. Races only.',
  },
  { id: 'carNumber', label: 'Car Number' },
  { id: 'driverName', label: 'Driver Name' },
  {
    id: 'status',
    label: 'Status',
    description:
      'PIT while the car is in the pit lane, OUT on the lap it leaves on, a penalty, and finished, DNF or DQ.',
  },
  { id: 'compound', label: 'Tyre Compound' },
  {
    id: 'stint',
    label: 'Stint',
    description: 'Laps since the car last stopped.',
  },
  {
    id: 'pitStops',
    label: 'Pit Stops',
    description:
      'Stops made, green while the car has asked for one. Le Mans Ultimate only.',
  },
  {
    id: 'energy',
    label: 'Energy Left',
    description:
      'Virtual energy or fuel remaining, percent. Le Mans Ultimate only.',
  },
  {
    id: 'energyUse',
    label: 'Energy per Lap',
    description:
      "The last lap's usage, percent of a full allocation. Le Mans Ultimate only.",
  },
  { id: 'bestTime', label: 'Best Time' },
  { id: 'lastTime', label: 'Last Time' },
  { id: 'speed', label: 'Speed' },
  {
    id: 'trackLimits',
    label: 'Track Limits',
    description: 'Track-limits penalty points. Le Mans Ultimate only.',
  },
  {
    id: 'gap',
    label: 'Gap / Line / Per Lap',
    description:
      'The gap now, the gap over the line last lap, and how much the gap has moved a lap over the last three laps. More than a lap apart it reads in laps.',
  },
  {
    id: 'forecast',
    label: 'Catch Forecast',
    description:
      'About how many laps until the gap is gone: green for a car you are catching, red for one catching you. Shown only after three laps in a row without a pit stop, and only while the gap is closing. Races only.',
  },
];

const defaultConfig = getWidgetDefaultConfig('battle');

interface DisplaySettingsListProps {
  itemsOrder: string[];
  onReorder: (newOrder: string[]) => void;
  settings: BattleWidgetSettings;
  handleConfigChange: (changes: Partial<BattleConfigShape>) => void;
}

const DisplaySettingsList = ({
  itemsOrder,
  onReorder,
  settings,
  handleConfigChange,
}: DisplaySettingsListProps) => {
  // A saved order lists the columns it knew; the rest follow in their
  // default order, so a column added since is there to switch on.
  const order = [
    ...itemsOrder,
    ...sortableSettings
      .map((setting) => setting.id)
      .filter((id) => !itemsOrder.includes(id)),
  ];
  const items = order
    .map((id) => sortableSettings.find((s) => s.id === id))
    .filter((s): s is SortableSetting => s != null);

  return (
    <SortableList
      items={items}
      onReorder={(newItems) => onReorder(newItems.map((i) => i.id))}
      renderItem={(setting, sortableProps) => {
        const column = settings.config[setting.id] ?? defaultConfig[setting.id];
        const isEnabled = column.enabled;

        return (
          <DraggableSettingItem
            key={setting.id}
            label={setting.label}
            enabled={isEnabled}
            onToggle={(enabled) => {
              handleConfigChange({
                [setting.id]: { ...column, enabled },
              });
            }}
            sortableProps={sortableProps}
          >
            {setting.description && (
              <p className="pl-8 mt-1 text-xs text-slate-400">
                {setting.description}
              </p>
            )}
            {isEnabled && setting.id === 'status' && (
              <div className="pl-8 mt-2">
                <SettingProp path="status.showPitTime" />
              </div>
            )}
            {isEnabled && setting.id === 'stint' && (
              <div className="pl-8 mt-2">
                <SettingProp path="stint.showEstimate" />
              </div>
            )}
            {isEnabled && setting.id === 'bestTime' && (
              <div className="pl-8 mt-2">
                <SettingProp path="bestTime.timeFormat" />
              </div>
            )}
            {isEnabled && setting.id === 'lastTime' && (
              <div className="pl-8 mt-2">
                <SettingProp path="lastTime.timeFormat" />
                <SettingProp path="lastTime.markInvalid" />
              </div>
            )}
            {isEnabled && setting.id === 'speed' && (
              <div className="pl-8 mt-2">
                <SettingProp path="speed.unit" />
              </div>
            )}
            {isEnabled && setting.id === 'gap' && (
              <div className="pl-8 mt-2">
                <SettingProp path="gap.decimalPlaces" />
              </div>
            )}
          </DraggableSettingItem>
        );
      }}
    />
  );
};

export const BattleSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as BattleWidgetSettings | undefined;

  const [settings, setSettings] = useState<BattleWidgetSettings>({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as BattleWidgetSettings['config']) ??
      defaultConfig,
  });

  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () => (localStorage.getItem('battleTab') as SettingsTabType) || 'display'
  );

  useEffect(() => {
    localStorage.setItem('battleTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) return <>Loading...</>;

  return (
    <BaseSettingsSection
      title="Battle"
      description="Your rivals: the car ahead of you and the car behind you in your class, with the gap to each, how it is moving, and their stint, stops and energy."
      settings={settings as BattleWidgetSettings}
      onSettingsChange={(s) => setSettings(s as BattleWidgetSettings)}
      widgetId={SETTING_ID}
    >
      {(handleConfigChange) => (
        <SettingProps
          widget={SETTING_ID}
          config={settings.config}
          onChange={handleConfigChange}
        >
          <div className="space-y-4">
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
              {/* DISPLAY TAB */}
              {activeTab === 'display' && (
                <>
                  <SettingsSection title="Display" scaleWidgetId={SETTING_ID}>
                    <h4 className="text-md font-medium text-slate-200">
                      Columns
                    </h4>
                    <DisplaySettingsList
                      itemsOrder={
                        settings.config.displayOrder ??
                        defaultConfig.displayOrder
                      }
                      onReorder={(newOrder) =>
                        handleConfigChange({ displayOrder: newOrder })
                      }
                      settings={settings}
                      handleConfigChange={handleConfigChange}
                    />
                  </SettingsSection>
                </>
              )}

              {/* OPTIONS TAB */}
              {activeTab === 'options' && (
                <SettingsSection title="Options">
                  <SettingProp path="header.enabled" />

                  <SettingDivider />

                  <SettingProp path="background.opacity" />

                  <SettingDivider />

                  <SettingProp path="showOnlyWhenOnTrack" />
                </SettingsSection>
              )}

              {/* VISIBILITY TAB */}
              {activeTab === 'visibility' && (
                <SettingsSection title="Session Visibility">
                  <SessionVisibility
                    sessionVisibility={settings.config.sessionVisibility}
                    handleConfigChange={handleConfigChange}
                  />
                </SettingsSection>
              )}
            </div>
          </div>
        </SettingProps>
      )}
    </BaseSettingsSection>
  );
};
