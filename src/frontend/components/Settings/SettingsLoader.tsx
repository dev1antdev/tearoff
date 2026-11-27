import { ReleaseNotesSettings } from './ReleaseNotes/ReleaseNotesSettings';
import type { ComponentType } from 'react';
import { useParams } from 'react-router-dom';
import type { WidgetId } from '@irdashies/types';
import { StandingsSettings } from './sections/StandingsSettings';
import { RelativeSettings } from './sections/RelativeSettings';
import { WeatherSettings } from './sections/WeatherSettings';
import { WeatherForecastSettings } from './sections/WeatherForecastSettings';
import { WindSettings } from './sections/WindSettings';
import { TrackMapSettings } from './sections/TrackMapSettings';
import { FlatTrackMapSettings } from './sections/FlatTrackMapSettings';
import { AdvancedSettings } from './sections/AdvancedSettings';
import { InputSettings } from './sections/InputSettings';
import { TachometerSettings } from './sections/TachometerSettings';
import { WidgetGroupSettings } from './sections/WidgetGroupSettings';
import { ShiftLightSettings } from './sections/ShiftLightSettings';
import { AboutSettings } from './sections/AboutSettings';
import { FasterCarsFromBehindSettings } from './sections/FasterCarsFromBehindSettings';
import { FuelSettings } from './sections/FuelSettings';
import { RejoinIndicatorSettings } from './sections/RejoinIndicatorSettings';
import { PitlaneHelperSettings } from './sections/PitlaneHelperSettings';
import { PitStopSettings } from './sections/PitStopSettings';
import { FuelSaverSettings } from './sections/FuelSaverSettings';
import { FinishProjectionSettings } from './sections/FinishProjectionSettings';
import { OurCarSettings } from './sections/OurCarSettings';
import { ClassRivalsSettings } from './sections/ClassRivalsSettings';
import { StintTimelineSettings } from './sections/StintTimelineSettings';
import { CrewSettings } from './sections/CrewSettings';
import { CarLapsSettings } from './sections/CarLapsSettings';
import { RaceChartsSettings } from './sections/RaceChartsSettings';
import { GeneralSettings } from './sections/GeneralSettings';
import { BlindSpotMonitorSettings } from './sections/BlindSpotMonitorSettings';
import { RadarSettings } from './sections/RadarSettings';
import { GarageCoverSettings } from './sections/GarageCoverSettings';
import { ProfileSettings } from './sections/ProfileSettings';
import { FlagSettings } from './sections/FlagSettings';
import { FlagPanelSettings } from './sections/FlagPanelSettings';
import { TrafficSettings } from './sections/TrafficSettings';
import { CarSetupSettings } from './sections/CarSetupSettings';
import { SetupLibrarySettings } from './sections/SetupLibrary/SetupLibrarySettings';
import { LapLibrarySettings } from './sections/LapLibrary/LapLibrarySettings';
import { StreamChatSettings } from './sections/StreamChatSettings';
import { DriverTagsSettings } from './sections/DriverTagsSettings';
import { KeybindingsSettings } from './sections/KeybindingsSettings';
import { RacePlanSettings } from './sections/RacePlanSettings';
import { LapTimeLogSettings } from './sections/LapTimeLogSettings';
import { StintHistorySettings } from './sections/StintHistorySettings';
import { InformationBarSettings } from './sections/InformationBarSettings';
import { useDashboard } from '@irdashies/context';
import { SlowCarAheadSettings } from './sections/SlowCarAheadSettings';
import { SectorDeltaSettings } from './sections/SectorDeltaSettings';
import { DeltaSpeedSettings } from './sections/DeltaSpeedSettings';
import { CarSystemsSettings } from './sections/CarSystemsSettings';
import { TyresSettings } from './sections/TyresSettings';
import { WearSettings } from './sections/WearSettings';
import { ChassisSettings } from './sections/ChassisSettings';
import { DamageSettings } from './sections/DamageSettings';
import { LiftCoastSettings } from './sections/LiftCoastSettings';
import { HybridSettings } from './sections/HybridSettings';
import { SystemPerformanceSettings } from './sections/SystemPerformanceSettings';
import { FrictionCircleSettings } from './sections/FrictionCircleSettings';
import { BrakePerformanceSettings } from './sections/BrakePerformanceSettings';
import { LapDeltaSettings } from './sections/LapDeltaSettings';
import { CornerDeltaSettings } from './sections/CornerDeltaSettings';
import { TimingSettings } from './sections/TimingSettings';
import { MinimapSettings } from './sections/MinimapSettings';
import { ElevationSettings } from './sections/ElevationSettings';
import { CruiseSettings } from './sections/CruiseSettings';
import { TrackNotesSettings } from './sections/TrackNotes/TrackNotesSettings';
import { HeartRateSettings } from './sections/HeartRateSettings';
import { CornerNameSettings } from './sections/CornerNameSettings';
import { LapTraceSettings } from './sections/LapTraceSettings';
import { BattleSettings } from './sections/BattleSettings';
import { ClassFieldsSettings } from './sections/ClassFieldsSettings';
import { TimingTowerSettings } from './sections/TimingTowerSettings';
import { BroadcastSettingsPage } from './sections/BroadcastGroupSettings';
import { GantrySettings } from './sections/GantrySettings';
import { PitWallSettings } from './sections/PitWallSettings';
import { RaceLogSettings } from './sections/RaceLogSettings';
import { SettingsPreviewContext } from '@irdashies/domain/widgetPreview/settingsPreviewContext';
import { widgetSettingsType } from './widgetSettingsType';
import { StintPlanSettings } from './sections/StintPlanSettings';
import { StrategyTimelineSettings } from './sections/StrategyTimelineSettings';

/**
 * Settings page per widget type. Telemetry Inspector has none of its own: its
 * settings live on the Advanced page.
 */
export const WIDGET_SETTINGS: Record<
  Exclude<WidgetId, 'telemetryinspector'>,
  ComponentType<{ widgetId?: string; widgetType?: string }>
> = {
  standings: StandingsSettings,
  relative: RelativeSettings,
  weather: WeatherSettings,
  weatherforecast: WeatherForecastSettings,
  wind: WindSettings,
  fuel: FuelSettings,
  map: TrackMapSettings,
  flatmap: FlatTrackMapSettings,
  input: InputSettings,
  tachometer: TachometerSettings,
  shiftlight: ShiftLightSettings,
  widgetgroup: WidgetGroupSettings,
  pitlanehelper: PitlaneHelperSettings,
  pitstop: PitStopSettings,
  fuelsaver: FuelSaverSettings,
  finishorder: FinishProjectionSettings,
  ourcar: OurCarSettings,
  classrivals: ClassRivalsSettings,
  stinttimeline: StintTimelineSettings,
  crew: CrewSettings,
  carlaps: CarLapsSettings,
  racecharts: RaceChartsSettings,
  rejoin: RejoinIndicatorSettings,
  fastercarsfrombehind: FasterCarsFromBehindSettings,
  blindspotmonitor: BlindSpotMonitorSettings,
  radar: RadarSettings,
  garagecover: GarageCoverSettings,
  flag: FlagSettings,
  flagpanel: FlagPanelSettings,
  traffic: TrafficSettings,
  streamchat: StreamChatSettings,
  laptimelog: LapTimeLogSettings,
  stinthistory: StintHistorySettings,
  infobar: InformationBarSettings,
  slowcarahead: SlowCarAheadSettings,
  sectordelta: SectorDeltaSettings,
  deltaspeed: DeltaSpeedSettings,
  carsystems: CarSystemsSettings,
  tyres: TyresSettings,
  wear: WearSettings,
  chassis: ChassisSettings,
  damage: DamageSettings,
  liftcoast: LiftCoastSettings,
  hybrid: HybridSettings,
  systemperformance: SystemPerformanceSettings,
  frictioncircle: FrictionCircleSettings,
  brakeperformance: BrakePerformanceSettings,
  lapdelta: LapDeltaSettings,
  cornerdelta: CornerDeltaSettings,
  timing: TimingSettings,
  minimap: MinimapSettings,
  elevation: ElevationSettings,
  cruise: CruiseSettings,
  tracknotes: TrackNotesSettings,
  heartrate: HeartRateSettings,
  cornername: CornerNameSettings,
  laptrace: LapTraceSettings,
  battle: BattleSettings,
  classfields: ClassFieldsSettings,
  timingtower: TimingTowerSettings,
  // The broadcast widgets share one page, with a tab per widget.
  broadcast: BroadcastSettingsPage,
  broadcastticker: BroadcastSettingsPage,
  broadcastevents: BroadcastSettingsPage,
  broadcastweather: BroadcastSettingsPage,
  broadcastpodium: BroadcastSettingsPage,
  gantry: GantrySettings,
  pitwall: PitWallSettings,
  racelog: RaceLogSettings,
  stintplan: StintPlanSettings,
  strategytimeline: StrategyTimelineSettings,
};

interface SettingsLoaderProps {
  previewMode?: boolean;
}

export const SettingsLoader = ({ previewMode }: SettingsLoaderProps = {}) => {
  const { widgetId } = useParams<{ widgetId: string }>();
  const { currentDashboard } = useDashboard();

  // 1. Handle non-widget pages
  if (widgetId === 'general')
    return <GeneralSettings previewMode={previewMode} />;
  if (widgetId === 'profiles') return <ProfileSettings />;
  if (widgetId === 'advanced') return <AdvancedSettings />;
  if (widgetId === 'car-setup') return <CarSetupSettings />;
  if (widgetId === 'setups') return <SetupLibrarySettings />;
  if (widgetId === 'laps') return <LapLibrarySettings />;
  if (widgetId === 'about') return <AboutSettings />;
  if (widgetId === 'release-notes') return <ReleaseNotesSettings />;
  if (widgetId === 'driver-tags') return <DriverTagsSettings />;
  if (widgetId === 'keybindings') return <KeybindingsSettings />;
  if (widgetId === 'race-plan') return <RacePlanSettings />;

  // 2. Find specific widget instance (may be undefined if widgetId is a type name)
  const widget = currentDashboard?.widgets.find((w) => w.id === widgetId);
  const type = widgetSettingsType(currentDashboard?.widgets, widgetId ?? '');

  const Settings = Object.hasOwn(WIDGET_SETTINGS, type)
    ? WIDGET_SETTINGS[type as keyof typeof WIDGET_SETTINGS]
    : undefined;
  if (Settings)
    return (
      <SettingsPreviewContext value={previewMode ? undefined : widgetId}>
        <Settings widgetId={widget?.id} widgetType={type} />
      </SettingsPreviewContext>
    );

  return widget ? (
    <div className="text-red-400">No settings available for {type}</div>
  ) : (
    <div className="text-slate-400">Select a widget to edit</div>
  );
};
