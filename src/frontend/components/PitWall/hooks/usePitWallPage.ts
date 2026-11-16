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

/**
 * The page the saved dashboard describes, less any panel the running sim
 * cannot support.
 */
export const usePitWallPage = (): ResolvedPitWall => {
  const { currentDashboard } = useDashboard();
  const simulator = useActiveSimulator();
  const support = useSimWidgetSupport();
  return useMemo(
    () => resolvePitWall(currentDashboard, { support, simulator }),
    [currentDashboard, support, simulator]
  );
};

/**
 * Saves the layout the header's switch chose into the Pit Wall's own config.
 * Does nothing while the profile has no Pit Wall widget to save it in.
 */
export const useSetPitWallLayout = () => {
  const { currentDashboard, onDashboardUpdated } = useDashboard();
  return useCallback(
    (layout: PitWallLayoutId) => {
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
    [currentDashboard, onDashboardUpdated]
  );
};
