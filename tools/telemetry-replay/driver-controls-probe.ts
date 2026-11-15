import * as yaml from 'js-yaml';
import type {
  DriverControlsSnapshot,
  Session,
  Telemetry,
} from '@irdashies/types';
import { DriverControlsProcessor } from '../../src/app/processors/DriverControlsProcessor';
import type { ReplayProbe, TelemetryFrame } from './validator';
import { rateLimited } from './rateLimited';

const telemetryFrom = (frame: TelemetryFrame): Telemetry =>
  Object.fromEntries(
    Object.entries(frame).map(([name, entry]) => [
      name,
      { value: Array.isArray(entry) ? entry : [entry] },
    ])
  ) as unknown as Telemetry;

export const createDriverControlsProbe =
  (): ReplayProbe<DriverControlsSnapshot> => {
    const processor = rateLimited(new DriverControlsProcessor());
    return {
      name: 'driver-controls-state',
      // 2: the snapshot gained the steering range, force feedback and the
      // brake pressure, read from the six variables at the end of the list.
      schemaVersion: 2,
      variables: [
        'SessionTick',
        'Brake',
        'BrakeRaw',
        'Throttle',
        'ThrottleRaw',
        'Clutch',
        'ClutchRaw',
        'Gear',
        'Speed',
        'DisplayUnits',
        'SteeringWheelAngle',
        'BrakeABSactive',
        'RPM',
        'ShiftGrindRPM',
        'OilTemp',
        'WaterTemp',
        'EngineWarnings',
        'SteeringWheelAngleMax',
        'SteeringWheelPctTorqueSign',
        'LFbrakeLinePress',
        'RFbrakeLinePress',
        'LRbrakeLinePress',
        'RRbrakeLinePress',
      ],
      onSessionInfo(text) {
        processor.init(yaml.load(text, { json: true }) as Session);
      },
      onFrame(frame) {
        processor.onFrame(telemetryFrom(frame));
        return { ...processor.snapshot() };
      },
      onDisconnect() {
        processor.onLifecycle({ type: 'disconnect' });
      },
    };
  };
