import { TrashIcon } from '@phosphor-icons/react';
import { useState, useEffect } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  TachometerLedRpmOverride,
  TachometerWidgetSettings,
  getWidgetDefaultConfig,
  SettingsTabType,
} from '@irdashies/types';
import { useDashboard } from '@irdashies/context';
import { isValidLedRpmOverride } from '@irdashies/domain/shiftLight/shiftLight';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingsSection } from '../components/SettingSection';
import { SettingToggleRow } from '../components/SettingToggleRow';
import { SettingDivider } from '../components/SettingDivider';
import { TabButton } from '../components/TabButton';
import { SettingButtonGroupRow } from '../components/SettingButtonGroupRow';
import { SettingSliderRow } from '../components/SettingSliderRow';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import { CustomShiftPointsSection } from '../components/CustomShiftPointsSection';
import { RpmField } from '../components/RpmField';
import { useCurrentCar, type CurrentCar } from '../hooks/useCurrentCar';

const SETTING_ID = 'tachometer';
const SettingProp = settingPropFor(SETTING_ID);

const LED_RPM_FIELDS = [
  { key: 'firstRpm', label: 'First LED' },
  { key: 'fullRpm', label: 'All LEDs' },
  { key: 'blinkRpm', label: 'Flash' },
] as const;

/** Where a newly added car starts: the thresholds the session holds for it. */
const startingLedRpm = (car: CurrentCar): TachometerLedRpmOverride => ({
  carName: car.carName,
  firstRpm:
    car.firstLedRpm > 0 && car.firstLedRpm < car.shiftRpm
      ? car.firstLedRpm
      : Math.round(car.shiftRpm * 0.75),
  fullRpm: car.shiftRpm,
  blinkRpm: Math.max(car.blinkRpm, car.shiftRpm),
});

/**
 * LED thresholds set by hand, for a car the automatic ones do not suit
 */
const LedThresholdsSection = ({
  config,
  handleConfigChange,
}: {
  config: TachometerWidgetSettings['config'];
  handleConfigChange: (
    changes: Partial<TachometerWidgetSettings['config']>
  ) => void;
}) => {
  const currentCar = useCurrentCar();
  const overrides = config.ledRpmOverrides ?? {};

  const setCar = (carId: string, car: TachometerLedRpmOverride) =>
    handleConfigChange({ ledRpmOverrides: { ...overrides, [carId]: car } });

  const deleteCar = (carId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [carId]: _removed, ...rest } = overrides;
    handleConfigChange({ ledRpmOverrides: rest });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        For a car whose LEDs come on at the wrong revs. Delete a car to return
        it to the automatic values.
      </p>

      {!currentCar && (
        <p className="text-sm text-slate-400">
          Start a session to add the car you are driving.
        </p>
      )}
      {currentCar && !overrides[currentCar.carId] && (
        <button
          type="button"
          onClick={() => setCar(currentCar.carId, startingLedRpm(currentCar))}
          className="settings-button-primary"
        >
          Add {currentCar.carName}
        </button>
      )}

      {Object.entries(overrides).map(([carId, car]) => (
        <div
          key={carId}
          className="rounded-md border border-slate-700 p-3 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-white">{car.carName}</span>
            <button
              type="button"
              aria-label={`Delete LED thresholds for ${car.carName}`}
              onClick={() => deleteCar(carId)}
              className="settings-button-danger inline-flex items-center gap-1"
            >
              <TrashIcon size={16} aria-hidden="true" />
              Delete
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {LED_RPM_FIELDS.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <span className="text-sm text-slate-300">{label}</span>
                <RpmField
                  ariaLabel={`${car.carName}, ${label} RPM`}
                  value={car[key]}
                  min={1}
                  isValid={(rpm) =>
                    isValidLedRpmOverride({ ...car, [key]: rpm })
                  }
                  error="Will not be saved: First LED must be below All LEDs, and Flash at or above All LEDs."
                  onCommit={(rpm) => setCar(carId, { ...car, [key]: rpm })}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const defaultConfig = getWidgetDefaultConfig('tachometer');

export const TachometerSettings = () => {
  const { currentDashboard } = useDashboard();
  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  ) as TachometerWidgetSettings | undefined;
  const [settings, setSettings] = useState<TachometerWidgetSettings>({
    enabled: savedSettings?.enabled ?? false,
    config:
      (savedSettings?.config as TachometerWidgetSettings['config']) ??
      defaultConfig,
  });

  // Tab state with persistence
  const [activeTab, setActiveTab] = useState<SettingsTabType>(
    () =>
      (localStorage.getItem('tachometerTab') as SettingsTabType) || 'display'
  );

  useEffect(() => {
    localStorage.setItem('tachometerTab', activeTab);
  }, [activeTab]);

  if (!currentDashboard) {
    return <>Loading...</>;
  }

  return (
    <BaseSettingsSection
      title="Tachometer"
      description="Configure the tachometer."
      settings={settings}
      onSettingsChange={setSettings}
      widgetId="tachometer"
    >
      {(handleConfigChange) => {
        const config = settings.config;
        // Defaulted temp display state so the toggle and the position section
        // stay in sync on existing dashboards where these are still undefined.
        const oilTempEnabled = config.oilTemp?.enabled ?? true;
        const oilTempPosition = config.oilTemp?.position ?? 'top';
        const oilTempEdgeOffset = config.oilTemp?.edgeOffset ?? 0;
        const waterTempEnabled = config.waterTemp?.enabled ?? true;
        const waterTempPosition = config.waterTemp?.position ?? 'top';
        const waterTempEdgeOffset = config.waterTemp?.edgeOffset ?? 0;
        const tempSwapSides = config.tempLayout?.swapSides ?? false;
        const anyTempEnabled = oilTempEnabled || waterTempEnabled;
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

              {/* DISPLAY TAB */}
              {activeTab === 'display' && (
                <>
                  <SettingsSection title="Display" scaleWidgetId={SETTING_ID}>
                    <SettingProp path="background.opacity" />

                    <SettingProp path="showRpmText" />

                    {config.showRpmText && (
                      <SettingsSection>
                        <SettingProp path="rpmOrientation" />
                      </SettingsSection>
                    )}
                    <SettingDivider />

                    <SettingToggleRow
                      title="Show Oil Temperature"
                      enabled={oilTempEnabled}
                      onToggle={(newValue) =>
                        handleConfigChange({
                          oilTemp: {
                            enabled: newValue,
                            position: oilTempPosition,
                            edgeOffset: oilTempEdgeOffset,
                          },
                        })
                      }
                    />

                    {oilTempEnabled && (
                      <SettingsSection>
                        <SettingButtonGroupRow<'top' | 'bottom'>
                          title="Oil Position"
                          value={oilTempPosition}
                          options={[
                            { label: 'Top', value: 'top' },
                            { label: 'Bottom', value: 'bottom' },
                          ]}
                          onChange={(v) =>
                            handleConfigChange({
                              oilTemp: {
                                enabled: oilTempEnabled,
                                position: v,
                                edgeOffset: oilTempEdgeOffset,
                              },
                            })
                          }
                        />
                        <SettingSliderRow
                          title="Oil Edge Offset"
                          value={oilTempEdgeOffset}
                          units="%"
                          min={0}
                          max={100}
                          step={1}
                          onChange={(v) =>
                            handleConfigChange({
                              oilTemp: {
                                enabled: oilTempEnabled,
                                position: oilTempPosition,
                                edgeOffset: v,
                              },
                            })
                          }
                        />
                      </SettingsSection>
                    )}

                    <SettingToggleRow
                      title="Show Water Temperature"
                      enabled={waterTempEnabled}
                      onToggle={(newValue) =>
                        handleConfigChange({
                          waterTemp: {
                            enabled: newValue,
                            position: waterTempPosition,
                            edgeOffset: waterTempEdgeOffset,
                          },
                        })
                      }
                    />

                    {waterTempEnabled && (
                      <SettingsSection>
                        <SettingButtonGroupRow<'top' | 'bottom'>
                          title="Water Position"
                          value={waterTempPosition}
                          options={[
                            { label: 'Top', value: 'top' },
                            { label: 'Bottom', value: 'bottom' },
                          ]}
                          onChange={(v) =>
                            handleConfigChange({
                              waterTemp: {
                                enabled: waterTempEnabled,
                                position: v,
                                edgeOffset: waterTempEdgeOffset,
                              },
                            })
                          }
                        />
                        <SettingSliderRow
                          title="Water Edge Offset"
                          value={waterTempEdgeOffset}
                          units="%"
                          min={0}
                          max={100}
                          step={1}
                          onChange={(v) =>
                            handleConfigChange({
                              waterTemp: {
                                enabled: waterTempEnabled,
                                position: waterTempPosition,
                                edgeOffset: v,
                              },
                            })
                          }
                        />
                      </SettingsSection>
                    )}

                    {anyTempEnabled && (
                      <SettingToggleRow
                        title="Swap Oil/Water Sides"
                        enabled={tempSwapSides}
                        onToggle={(newValue) =>
                          handleConfigChange({
                            tempLayout: { swapSides: newValue },
                          })
                        }
                      />
                    )}
                  </SettingsSection>
                </>
              )}

              {/* OPTIONS TAB */}
              {activeTab === 'options' && (
                <>
                  <SettingsSection title="Custom Shift Points">
                    <CustomShiftPointsSection
                      settings={config.shiftPointSettings}
                      onChange={(shiftPointSettings) =>
                        handleConfigChange({ shiftPointSettings })
                      }
                      description="If enabled, custom shift points will be displayed on the tachometer"
                    />
                  </SettingsSection>
                  <SettingsSection title="LED thresholds">
                    <LedThresholdsSection
                      config={config}
                      handleConfigChange={handleConfigChange}
                    />
                  </SettingsSection>
                </>
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
