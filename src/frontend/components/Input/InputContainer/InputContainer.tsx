import { memo, useCallback, useMemo, type ReactNode } from 'react';
import type { InputWidgetSettings, LayoutNode } from '@irdashies/types';
import { InputAbsIndicator } from '../InputAbsIndicator/InputAbsIndicator';
import { InputBar } from '../InputBar/InputBar';
import { InputGear } from '../InputGear/InputGear';
import { InputSteer } from '../InputSteer/InputSteer';
import { InputSteerMeter } from '../InputSteerMeter/InputSteerMeter';
import { InputTrace } from '../InputTrace/InputTrace';
import { getInputLayoutTree } from '../layout';

export interface InputProps {
  /** The pedals of the chosen input source. */
  brake?: number;
  throttle?: number;
  clutch?: number;
  /** Pedal travel and what the car received, for the bars that draw both. */
  brakePedal?: number;
  throttlePedal?: number;
  clutchPedal?: number;
  brakeCar?: number;
  throttleCar?: number;
  clutchCar?: number;
  gear?: number;
  speed?: number;
  unit?: number;
  steer?: number;
  /** Lock-to-lock rotation the steering meter is drawn against, degrees. */
  steerRangeDeg?: number;
  frontWheelAngleDeg?: number;
  stationary?: boolean;
  ffb?: number;
  brakeAbsActive?: boolean;
  tcActive?: boolean;
  traceTick?: number;
  settings: InputWidgetSettings['config'];
  /** Background colour while the shift flash is on. */
  flashColor?: string;
  /** Gear number colour while a shift flash is on. */
  gearFlashColor?: string;
}

interface LayoutNodeViewProps {
  node: LayoutNode;
  renderElement: (id: string) => ReactNode;
}

// Declared at module level so its identity is stable. A component declared
// inside render would remount every element (and wipe the trace) each frame.
const LayoutNodeView = ({ node, renderElement }: LayoutNodeViewProps) => {
  const style = { flex: `${node.weight || 1} 1 0%` };
  const direction = node.direction === 'row' ? 'flex-row' : 'flex-col';

  if (node.type === 'box') {
    return (
      <div className={`flex ${direction} gap-1 min-w-0 min-h-0`} style={style}>
        {[...new Set(node.widgets)].map((id) => (
          <div key={id} className="flex flex-1 min-w-0 min-h-0">
            {renderElement(id)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex ${direction} gap-1 min-w-0 min-h-0`} style={style}>
      {node.children.map((child) => (
        <LayoutNodeView
          key={child.id}
          node={child}
          renderElement={renderElement}
        />
      ))}
    </div>
  );
};

/** Render the configured layout tree, feeding each element its selected inputs. */
export const InputContainer = memo(
  ({
    brake,
    throttle,
    clutch,
    brakePedal,
    throttlePedal,
    clutchPedal,
    brakeCar,
    throttleCar,
    clutchCar,
    gear,
    speed,
    steer,
    steerRangeDeg,
    frontWheelAngleDeg,
    stationary,
    ffb,
    unit,
    brakeAbsActive,
    tcActive,
    traceTick,
    settings,
    flashColor,
    gearFlashColor,
  }: InputProps) => {
    const tree = useMemo(() => getInputLayoutTree(settings), [settings]);

    const traceInput = useMemo(
      () => ({
        brake,
        throttle,
        clutch,
        brakeAbsActive,
        tcActive,
        steer,
        traceTick,
      }),
      [brake, throttle, clutch, brakeAbsActive, tcActive, steer, traceTick]
    );
    const renderElement = useCallback(
      (id: string) => {
        switch (id) {
          case 'trace':
            return <InputTrace input={traceInput} settings={settings.trace} />;
          case 'bar':
            return (
              <InputBar
                brake={brake}
                brakeAbsActive={brakeAbsActive}
                throttle={throttle}
                tcActive={tcActive}
                clutch={clutch}
                brakePedal={brakePedal}
                throttlePedal={throttlePedal}
                clutchPedal={clutchPedal}
                brakeCar={brakeCar}
                throttleCar={throttleCar}
                clutchCar={clutchCar}
                ffb={ffb}
                settings={settings.bar}
              />
            );
          case 'gear':
            return (
              <InputGear
                gear={gear}
                speedMs={speed}
                unit={unit}
                settings={settings.gear}
                flashColor={gearFlashColor}
              />
            );
          case 'abs':
            return (
              <div className="flex flex-1 min-w-0 items-center justify-center p-2">
                <InputAbsIndicator
                  absActive={brakeAbsActive ?? false}
                  className="w-full h-full aspect-[512/357.25]"
                />
              </div>
            );
          case 'steer':
            return (
              <InputSteer
                angleRad={steer}
                wheelStyle={settings.steer.config?.style}
                wheelColor={settings.steer.config?.color}
                gear={gear}
                speedMs={speed}
                unit={unit}
                gearSettings={settings.gear}
                flashColor={gearFlashColor}
                angleReadout={settings.steer.angleReadout}
                rotationArc={settings.steer.rotationArc}
                stationary={stationary}
                frontWheelAngleDeg={
                  settings.steer.showWheelAngle ? frontWheelAngleDeg : undefined
                }
              />
            );
          case 'steermeter':
            return (
              <InputSteerMeter
                angleRad={steer}
                rangeDeg={steerRangeDeg}
                markDeg={settings.steerMeter?.markDeg}
                showAngle={settings.steerMeter?.showAngle}
              />
            );
          default:
            return null;
        }
      },
      [
        traceInput,
        brake,
        throttle,
        clutch,
        brakePedal,
        throttlePedal,
        clutchPedal,
        brakeCar,
        throttleCar,
        clutchCar,
        gear,
        speed,
        steer,
        steerRangeDeg,
        frontWheelAngleDeg,
        stationary,
        ffb,
        unit,
        brakeAbsActive,
        tcActive,
        settings,
        gearFlashColor,
      ]
    );

    return (
      <div
        className="w-full h-full flex p-2 rounded-md bg-slate-800/(--bg-opacity)"
        style={{
          ['--bg-opacity' as string]: `${settings.background?.opacity ?? 80}%`,
          backgroundColor: flashColor,
        }}
      >
        <LayoutNodeView node={tree} renderElement={renderElement} />
      </div>
    );
  }
);
InputContainer.displayName = 'InputContainer';
