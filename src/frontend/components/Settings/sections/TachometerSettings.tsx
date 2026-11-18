import {
  CaretDownIcon,
  CaretRightIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useState, useEffect, useId } from 'react';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import {
  TachometerLedRpmOverride,
  TachometerWidgetSettings,
  getWidgetDefaultConfig,
  SettingsTabType,
} from '@irdashies/types';
import { useDashboard, useSessionStore } from '@irdashies/context';
import { isValidLedRpmOverride } from '@irdashies/domain/shiftLight/shiftLight';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { SessionVisibility } from '../components/SessionVisibility';
import { getAvailableCars, loadCarData } from '../../../utils/carData';
import { SettingsSection } from '../components/SettingSection';
import { SettingToggleRow } from '../components/SettingToggleRow';
import { SettingDivider } from '../components/SettingDivider';
import { TabButton } from '../components/TabButton';
import { SettingButtonGroupRow } from '../components/SettingButtonGroupRow';
import { SettingSliderRow } from '../components/SettingSliderRow';
import logger from '@irdashies/utils/logger';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import {
  DEFAULT_SHIFT_RPM_RATIO,
  currentModelCarConfig,
  useCurrentModelCar,
} from '../hooks/useCurrentModelCar';

const SETTING_ID = 'tachometer';
const SettingProp = settingPropFor(SETTING_ID);

// Constants for shift points
const MIN_SHIFT_RPM = 1000;

const LED_RPM_FIELDS = [
  { key: 'firstRpm', label: 'First LED' },
  { key: 'fullRpm', label: 'All LEDs' },
  { key: 'blinkRpm', label: 'Flash' },
] as const;

// TypeScript interfaces for GitHub API responses
interface CarListItem {
  carId: string;
  carName: string;
  ledNumber: number;
  ledRpm: object[];
}

/**
 * The car being driven, under the key the widget finds its LED thresholds by,
 * with the thresholds the session holds for it as the starting point.
 */
const useCurrentCarLedRpm = ():
  | (TachometerLedRpmOverride & { carId: string })
  | undefined => {
  const info = useSessionStore((state) => state.session?.DriverInfo);
  const driver = info?.Drivers?.find((d) => d.CarIdx === info.DriverCarIdx);
  const carModel = driver?.CarModel;
  const carPath = driver?.CarPath;
  const carData = !carModel && carPath ? loadCarData(carPath) : null;
  const carId = carModel || carData?.carId || carPath;
  if (!carId) return undefined;

  const redline = info?.DriverCarRedLine || 8000;
  const fullRpm =
    info?.DriverCarSLShiftRPM || Math.round(redline * DEFAULT_SHIFT_RPM_RATIO);
  const firstRpm = info?.DriverCarSLFirstRPM ?? 0;
  return {
    carId,
    carName: carModel || carData?.carName || carId,
    firstRpm:
      firstRpm > 0 && firstRpm < fullRpm
        ? firstRpm
        : Math.round(fullRpm * 0.75),
    fullRpm,
    blinkRpm: Math.max(
      info?.DriverCarSLBlinkRPM || Math.round(redline * 0.97),
      fullRpm
    ),
  };
};

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
  const hintId = useId();
  const currentCar = useCurrentCarLedRpm();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const overrides = config.ledRpmOverrides ?? {};

  const withValue = (
    carId: string,
    key: (typeof LED_RPM_FIELDS)[number]['key'],
    text: string
  ): TachometerLedRpmOverride => ({
    ...overrides[carId],
    [key]: parseInt(text, 10),
  });

  const addCurrentCar = () => {
    if (!currentCar) return;
    const { carId, ...override } = currentCar;
    handleConfigChange({
      ledRpmOverrides: { ...overrides, [carId]: override },
    });
  };

  const deleteCar = (carId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [carId]: _removed, ...rest } = overrides;
    handleConfigChange({ ledRpmOverrides: rest });
  };

  return (
    <div className="space-y-3">
      <p id={hintId} className="text-sm text-slate-400">
        For a car whose LEDs come on at the wrong revs. First LED must be below
        All LEDs, and Flash at or above it. Delete a car to return it to the
        automatic values.
      </p>

      {!currentCar && (
        <p className="text-sm text-slate-400">
          Start a session to add the car you are driving.
        </p>
      )}
      {currentCar && !overrides[currentCar.carId] && (
        <button
          type="button"
          onClick={addCurrentCar}
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
            {LED_RPM_FIELDS.map(({ key, label }) => {
              const draftKey = `${carId}-${key}`;
              const draft = drafts[draftKey];
              return (
                <label
                  key={key}
                  className="flex flex-col gap-1 text-sm text-slate-300"
                >
                  {label}
                  <input
                    aria-label={`${car.carName}, ${label} RPM`}
                    aria-describedby={hintId}
                    aria-invalid={
                      draft !== undefined &&
                      !isValidLedRpmOverride(withValue(carId, key, draft))
                    }
                    type="number"
                    min={1}
                    value={draft ?? car[key]}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [draftKey]: e.target.value })
                    }
                    onBlur={() => {
                      if (draft === undefined) return;
                      const next = withValue(carId, key, draft);
                      if (isValidLedRpmOverride(next)) {
                        handleConfigChange({
                          ledRpmOverrides: { ...overrides, [carId]: next },
                        });
                      }
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const { [draftKey]: _committed, ...rest } = drafts;
                      setDrafts(rest);
                    }}
                    className="settings-field"
                  />
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Custom shift points configuration section
 */
const CustomShiftPointsSection = ({
  config,
  handleConfigChange,
}: {
  config: TachometerWidgetSettings['config'];
  handleConfigChange: (
    changes: Partial<TachometerWidgetSettings['config']>
  ) => void;
}) => {
  const fieldId = useId();
  const [expandedCarId, setExpandedCarId] = useState<string | null>(null);
  const [availableCars, setAvailableCars] = useState<CarListItem[]>([]);
  const [selectedCarId, setSelectedCarId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>(
    {}
  );

  const customShiftPoints = config.shiftPointSettings;
  const currentModelCar = useCurrentModelCar();

  const updateCustomShiftPoints = (
    updates: Partial<typeof customShiftPoints>
  ) => {
    handleConfigChange({
      shiftPointSettings: {
        ...customShiftPoints,
        ...updates,
      },
    });
  };

  useEffect(() => {
    const loadAvailableCars = () => {
      if (!customShiftPoints.enabled || availableCars.length > 0) return;

      setLoading(true);
      try {
        const allCars = getAvailableCars();
        const cars: CarListItem[] = allCars
          .map((car) => ({
            carId: car.carId,
            carName: car.carName,
            ledNumber: car.ledNumber,
            ledRpm: car.ledRpm,
          }))
          .sort((a, b) => a.carName.localeCompare(b.carName));

        setAvailableCars(cars);
      } catch (err) {
        logger.error('Failed to load cars:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load car data'
        );
      } finally {
        setLoading(false);
      }
    };

    loadAvailableCars();
  }, [customShiftPoints.enabled, availableCars.length]);

  const addCar = () => {
    if (currentModelCar && selectedCarId === currentModelCar.carId) {
      updateCustomShiftPoints({
        carConfigs: {
          ...customShiftPoints.carConfigs,
          [currentModelCar.carId]: currentModelCarConfig(currentModelCar),
        },
      });
      setSelectedCarId('');
      return;
    }
    const selectedCar = availableCars.find((c) => c.carId === selectedCarId);
    if (!selectedCar) return;

    const ledRpmData = (selectedCar.ledRpm?.[0] || {}) as Record<
      string,
      number[]
    >;

    logger.info(JSON.stringify(selectedCar));

    let redlineRpm = 8000;
    if (selectedCar.ledRpm?.[0]) {
      const allRpms = Object.values(ledRpmData).flat();
      redlineRpm = Math.max(...allRpms);
    }

    const gearKeys = Object.keys(ledRpmData).filter(
      (key) =>
        key !== 'N' && key !== 'R' && !isNaN(Number(key)) && Number(key) > 0
    );

    const gearCount =
      gearKeys.length > 0 ? Math.max(...gearKeys.map(Number)) : 6;
    const gearShiftPoints: Record<string, { shiftRpm: number }> = {};
    const defaultShiftRpm = Math.round(redlineRpm * DEFAULT_SHIFT_RPM_RATIO);

    for (let i = 1; i <= gearCount; i++) {
      const gearKey = i.toString();
      const gearData = ledRpmData[gearKey];

      gearShiftPoints[gearKey] = {
        shiftRpm: gearData
          ? Math.max(...gearData)
          : Math.max(MIN_SHIFT_RPM, defaultShiftRpm),
      };
    }

    updateCustomShiftPoints({
      carConfigs: {
        ...customShiftPoints.carConfigs,
        [selectedCarId]: {
          enabled: true,
          carId: selectedCarId,
          carName: selectedCar.carName,
          gearCount,
          redlineRpm,
          gearShiftPoints,
        },
      },
    });

    setSelectedCarId('');
  };

  const toggleCar = (carId: string, enabled: boolean) => {
    updateCustomShiftPoints({
      carConfigs: {
        ...customShiftPoints.carConfigs,
        [carId]: {
          ...customShiftPoints.carConfigs[carId],
          enabled,
        },
      },
    });
  };

  const updateShiftPoint = (carId: string, gear: string, shiftRpm: number) => {
    const car = customShiftPoints.carConfigs[carId];
    if (!car) return;

    updateCustomShiftPoints({
      carConfigs: {
        ...customShiftPoints.carConfigs,
        [carId]: {
          ...car,
          gearShiftPoints: {
            ...car.gearShiftPoints,
            [gear]: { shiftRpm },
          },
        },
      },
    });
  };

  const deleteCar = (carId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [carId]: _removed, ...rest } = customShiftPoints.carConfigs;
    updateCustomShiftPoints({
      carConfigs: rest,
    });
  };

  const configuredCars = Object.values(customShiftPoints.carConfigs);
  const availableToAdd = availableCars.filter(
    (c) => !customShiftPoints.carConfigs[c.carId]
  );
  const canAddCurrentModelCar =
    !!currentModelCar && !customShiftPoints.carConfigs[currentModelCar.carId];

  return (
    <div className="space-y-3">
      <SettingToggleRow
        title="Enable Custom Shift Points"
        description="If enabled, custom shift points will be displayed on the tachometer"
        enabled={customShiftPoints.enabled ?? false}
        onToggle={(enabled) => updateCustomShiftPoints({ enabled })}
      />

      {configuredCars.length > 0 && (
        <div className="text-md text-slate-300">
          ({configuredCars.length} cars)
        </div>
      )}

      {customShiftPoints.enabled && (
        <div className="space-y-4 border-slate-700 pl-4">
          {/* Demo Mode Info */}
          <div className="bg-slate-800/40 border border-slate-700 rounded p-3 text-xs">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-slate-200 mb-1">Demo Mode Car</p>
                <p className="text-slate-400">
                  Demo mode uses the <strong>BMW M4 GT4</strong> (bmwm4gt4).
                  Configure custom shift points for this car to test in demo
                  mode.
                </p>
              </div>
            </div>
          </div>

          {/* Indicator Settings */}
          <div className="space-y-2">
            <label
              htmlFor={`${fieldId}-type`}
              className="text-sm text-slate-300"
            >
              Indicator Type
            </label>
            <select
              id={`${fieldId}-type`}
              value={customShiftPoints.indicatorType}
              onChange={(e) =>
                updateCustomShiftPoints({
                  indicatorType: e.target.value as 'glow' | 'pulse' | 'border',
                })
              }
              className="settings-field w-full"
            >
              <option value="glow">Glow</option>
              <option value="pulse">Pulse</option>
              <option value="border">Border</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor={`${fieldId}-color`}
              className="text-sm text-slate-300"
            >
              Indicator Color
            </label>
            <input
              type="color"
              id={`${fieldId}-color`}
              value={customShiftPoints.indicatorColor}
              onChange={(e) =>
                updateCustomShiftPoints({ indicatorColor: e.target.value })
              }
              className="h-9 w-14 rounded border border-settings-boundary bg-settings-control cursor-pointer"
            />
          </div>

          {/* Add Car */}
          <div className="space-y-2">
            <label
              htmlFor={`${fieldId}-car`}
              className="text-sm text-slate-300"
            >
              Add Car
            </label>
            <div className="flex gap-2">
              <select
                id={`${fieldId}-car`}
                value={selectedCarId}
                onChange={(e) => setSelectedCarId(e.target.value)}
                className="settings-field flex-1"
                disabled={loading}
              >
                <option value="">Select a car...</option>
                {canAddCurrentModelCar && (
                  <option value={currentModelCar.carId}>
                    {currentModelCar.carId} (current car)
                  </option>
                )}
                {availableToAdd.map((car) => (
                  <option key={car.carId} value={car.carId}>
                    {car.carName}
                  </option>
                ))}
              </select>
              <button
                onClick={addCar}
                disabled={!selectedCarId || loading}
                className="settings-button-primary"
              >
                Add
              </button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>

          {/* Configured Cars */}
          {configuredCars.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs text-slate-400">Configured Cars</label>
              <div className="space-y-2">
                {configuredCars.map((car) => (
                  <div
                    key={car.carId}
                    className="rounded-md border border-slate-700 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setExpandedCarId(
                              expandedCarId === car.carId ? null : car.carId
                            )
                          }
                          type="button"
                          aria-label={`Shift points for ${car.carName}`}
                          aria-expanded={expandedCarId === car.carId}
                          aria-controls={`${fieldId}-${car.carId}`}
                          className="settings-button h-9 w-9 shrink-0 p-0"
                        >
                          <span aria-hidden="true">
                            {expandedCarId === car.carId ? (
                              <CaretDownIcon size={16} />
                            ) : (
                              <CaretRightIcon size={16} />
                            )}
                          </span>
                        </button>
                        <span className="text-sm text-white">
                          {car.carName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ToggleSwitch
                          ariaLabel={`Enable custom shift points for ${car.carName}`}
                          enabled={car.enabled}
                          onToggle={(enabled) => toggleCar(car.carId, enabled)}
                        />
                        <button
                          aria-label={`Delete shift points for ${car.carName}`}
                          onClick={() => deleteCar(car.carId)}
                          className="settings-button-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {expandedCarId === car.carId && (
                      <div
                        id={`${fieldId}-${car.carId}`}
                        className="space-y-3 pt-3 border-t border-slate-700"
                      >
                        <p className="text-xs text-slate-400">
                          Redline: {car.redlineRpm} RPM
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(car.gearShiftPoints).map(
                            ([gear, { shiftRpm }]) => (
                              <div
                                key={gear}
                                className="flex items-center gap-2"
                              >
                                <label className="text-xs text-slate-400 w-12">
                                  Gear {gear}:
                                </label>
                                <input
                                  aria-label={`${car.carName}, gear ${gear} shift RPM`}
                                  type="number"
                                  value={
                                    editingValues[`${car.carId}-${gear}`] ??
                                    shiftRpm
                                  }
                                  onChange={(e) => {
                                    const key = `${car.carId}-${gear}`;
                                    setEditingValues({
                                      ...editingValues,
                                      [key]: e.target.value,
                                    });
                                  }}
                                  onBlur={(e) => {
                                    const value = parseInt(e.target.value);
                                    if (
                                      !isNaN(value) &&
                                      value >= MIN_SHIFT_RPM
                                    ) {
                                      updateShiftPoint(car.carId, gear, value);
                                    }
                                    const key = `${car.carId}-${gear}`;
                                    setEditingValues(
                                      Object.fromEntries(
                                        Object.entries(editingValues).filter(
                                          ([k]) => k !== key
                                        )
                                      )
                                    );
                                  }}
                                  className="settings-field flex-1"
                                  min={MIN_SHIFT_RPM}
                                  max={car.redlineRpm}
                                />
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
                      config={config}
                      handleConfigChange={handleConfigChange}
                    />
                  </SettingsSection>
                  <SettingsSection title="LED Thresholds">
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
