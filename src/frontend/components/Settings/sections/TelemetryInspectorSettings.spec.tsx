import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardLayout } from '@irdashies/types';
import { TelemetryInspectorSettings } from './TelemetryInspectorSettings';

vi.mock('../components/WidgetPreview', () => ({ WidgetPreview: () => null }));

const mocks = vi.hoisted(() => ({
  dashboard: undefined as DashboardLayout | undefined,
  update: vi.fn(),
}));

vi.mock('@irdashies/context', async () => {
  const { DEFAULT_SIM_WIDGET_SUPPORT } = await import('@irdashies/types');
  return {
    useDashboard: () => ({
      currentDashboard: mocks.dashboard,
      onDashboardUpdated: mocks.update,
      bridge: {},
    }),
    useActiveSimulator: () => null,
    useElementSize: () => ({ width: 800, height: 240 }),
    useSimWidgetSupport: () => DEFAULT_SIM_WIDGET_SUPPORT,
  };
});

/** A dashboard whose inspector is already watching these telemetry keys. */
const dashboardWatching = (...paths: string[]): DashboardLayout => ({
  widgets: [
    {
      id: 'telemetryinspector',
      enabled: true,
      layout: { x: 30, y: 50, width: 300, height: 100 },
      config: {
        properties: paths.map((path) => ({ source: 'telemetry', path })),
      },
    },
  ],
  generalSettings: {},
});

beforeEach(() => {
  mocks.update.mockReset();
  localStorage.clear();
  mocks.dashboard = dashboardWatching('Speed');
});

/** The properties the widget would be watching after the last change. */
const watched = (): { source: string; path: string; label?: string }[] => {
  const updated: DashboardLayout | undefined = mocks.update.mock.lastCall?.[0];
  const config = updated?.widgets.find(
    (widget) => widget.id === 'telemetryinspector'
  )?.config as { properties?: { source: string; path: string }[] } | undefined;
  return config?.properties ?? [];
};

/**
 * The frame keys Le Mans Ultimate fills from its wheels, chassis, damage,
 * hybrid and pit fields, each with the name of its quick-add button. They
 * feed widgets that are not built yet, so this list is where they can be
 * watched in the sim.
 */
const QUICK_ADD: [label: string, path: string][] = [
  ['Yaw North', 'YawNorth'],
  ['Velocity X (Forward)', 'VelocityX'],
  ['Velocity Y (Left)', 'VelocityY'],
  ['Velocity Z (Up)', 'VelocityZ'],
  ['Lateral Accel', 'LatAccel'],
  ['Longitudinal Accel', 'LongAccel'],
  ['LMU Session End Time', 'LmuSessionEndTime'],
  ['LMU Car Pit State', 'LmuCarIdxPitState'],
  ['LMU Car Pit Stops', 'LmuCarIdxPitStops'],
  ['LMU Car In Garage', 'LmuCarIdxInGarage'],
  ['LMU Motor State', 'LmuMotorState'],
  ['LMU Battery Charge', 'LmuBatteryCharge'],
  ['LMU Motor Torque', 'LmuMotorTorque'],
  ['LMU Motor RPM', 'LmuMotorRPM'],
  ['LMU Motor Temp', 'LmuMotorTemp'],
  ['LMU Motor Coolant Temp', 'LmuMotorCoolantTemp'],
  ['LMU Lift And Coast', 'LmuLiftAndCoast'],
  ['LMU Ride Height', 'LmuWheelRideHeight'],
  ['LMU Suspension Position', 'LmuSuspensionPosition'],
  ['LMU Suspension Force', 'LmuSuspensionForce'],
  ['LMU Tyre Load', 'LmuTyreLoad'],
  ['LMU Tyre Deflection', 'LmuTyreDeflection'],
  ['LMU Camber', 'LmuWheelCamber'],
  ['LMU Toe', 'LmuWheelToe'],
  ['LMU Wheel Rotation', 'LmuWheelRotation'],
  ['LMU Tyre Static Radius', 'LmuTyreStaticRadius'],
  ['LMU Wheel Surface', 'LmuWheelSurfaceType'],
  ['LMU Third Spring Deflection', 'LmuThirdSpringDeflection'],
  ['LMU Last Impact Time', 'LmuLastImpactTime'],
  ['LMU Last Impact Magnitude', 'LmuLastImpactMagnitude'],
  ['LMU Last Impact Position', 'LmuLastImpactPos'],
  ['LMU Dent Severity', 'LmuDentSeverity'],
  ['LMU Body Detached', 'LmuBodyDetached'],
  ['LMU Overheating', 'LmuOverheating'],
  ['LMU Tyre Flat', 'LmuTyreFlat'],
  ['LMU Wheel Detached', 'LmuWheelDetached'],
  ['LMU World Position', 'LmuPlayerWorldPos'],
];

describe('the Telemetry Inspector’s quick-add list', () => {
  it.each(QUICK_ADD)('offers %s, which watches %s', (label, path) => {
    render(<TelemetryInspectorSettings />);

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(watched()).toEqual([
      { source: 'telemetry', path: 'Speed' },
      { source: 'telemetry', path, label },
    ]);
  });

  it('names every button differently, so each can be told from the rest', () => {
    const labels = QUICK_ADD.map(([label]) => label);
    const paths = QUICK_ADD.map(([, path]) => path);

    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('greys out a key that is already watched', () => {
    mocks.dashboard = dashboardWatching('Speed', 'LmuWheelRideHeight');
    render(<TelemetryInspectorSettings />);

    expect(
      screen.getByRole('button', { name: 'LMU Ride Height' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'LMU Toe' })).toBeEnabled();
  });
});
