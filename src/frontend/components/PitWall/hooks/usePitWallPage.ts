import { useCallback, useMemo } from 'react';
import {
  useActiveSimulator,
  useDashboard,
  useSimWidgetSupport,
} from '@irdashies/context';
import {
  PIT_WALL_WIDGET_ID,
  resolvePitWall,
  sanitizePitWallConfig,
  type PitWallLayoutId,
  type ResolvedPitWall,
} from '@irdashies/types';
import { usePitWallDeviceLayout } from '../PitWallDeviceLayout';

/**
 * The page the saved dashboard describes, less any panel the running sim
 * cannot support. In a browser the layout is the one chosen on that device,
 * where one has been.
 */
export const usePitWallPage = (): ResolvedPitWall => {
  const { currentDashboard } = useDashboard();
  const simulator = useActiveSimulator();
  const support = useSimWidgetSupport();
  const deviceLayout = usePitWallDeviceLayout()?.layout;
  return useMemo(
    () =>
      resolvePitWall(currentDashboard, { support, simulator }, deviceLayout),
    [currentDashboard, support, simulator, deviceLayout]
  );
};

/**
 * Saves the layout the header's switch chose into the Pit Wall's own config.
 * Does nothing while the profile has no Pit Wall widget to save it in.
 *
 * In a browser the choice is kept on the device and the profile is left as
 * it is.
 */
export const useSetPitWallLayout = () => {
  const { currentDashboard, onDashboardUpdated } = useDashboard();
  const device = usePitWallDeviceLayout();
  return useCallback(
    (layout: PitWallLayoutId) => {
      if (device) {
        device.setLayout(layout);
        return;
      }
      if (!currentDashboard || !onDashboardUpdated) return;
      const saved = currentDashboard.widgets.find(
        (widget) => widget.id === PIT_WALL_WIDGET_ID
      );
      if (!saved || sanitizePitWallConfig(saved.config).layout === layout) {
        return;
      }
      onDashboardUpdated({
        ...currentDashboard,
        widgets: currentDashboard.widgets.map((widget) =>
          widget.id === PIT_WALL_WIDGET_ID
            ? { ...widget, config: { ...widget.config, layout } }
            : widget
        ),
      });
    },
    [currentDashboard, onDashboardUpdated, device]
  );
};
