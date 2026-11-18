import { memo, useMemo } from 'react';
import {
  useActiveSimulator,
  useDashboard,
  useDrivingState,
  useHiddenWidgetIds,
  useRunningState,
  useSessionVisibility,
  useSimWidgetSupport,
} from '@irdashies/context';
import { useWidgetScale } from '@irdashies/domain/widgetPresentation/WidgetScale';
import {
  findWidgetGroup,
  normalizeWidgetScale,
  resolveWidgetGroupMembers,
  type WidgetGroupWidgetSettings,
} from '@irdashies/types';
import { HostedWidget } from '../WidgetPanelHost/HostedWidget';

/**
 * One block on the overlay with other widgets placed inside it. Positions are
 * in the group's own pixels, so the group's scale carries the whole
 * arrangement, and a member's scale comes on top of it.
 */
export const WidgetGroup = memo(() => {
  const { currentDashboard } = useDashboard();
  const simulator = useActiveSimulator();
  const support = useSimWidgetSupport();
  const { running } = useRunningState();
  const hidden = useHiddenWidgetIds();
  const groupScale = useWidgetScale();
  const { isDriving, isWatching } = useDrivingState();
  const config = findWidgetGroup(currentDashboard?.widgets)?.config as
    WidgetGroupWidgetSettings['config'] | undefined;
  const sessionVisible = useSessionVisibility(config?.sessionVisibility);
  const members = useMemo(
    () => resolveWidgetGroupMembers(currentDashboard, { support, simulator }),
    [currentDashboard, support, simulator]
  );

  if (!sessionVisible) return null;
  if (config?.showOnlyWhenOnTrack && !(isDriving || isWatching)) return null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {members.map(({ member, widget }) =>
        // The same two rules the overlay applies to a widget of its own.
        hidden.has(widget.id) || !(running || widget.alwaysEnabled) ? null : (
          <div
            key={widget.id}
            data-group-member={widget.id}
            className="absolute [contain:layout_style_paint]"
            style={{
              left: member.x,
              top: member.y,
              width: member.width,
              height: member.height,
            }}
          >
            <HostedWidget
              widget={widget}
              running
              host="widget-group"
              waitingMessage=""
              embedded={false}
              exactScale
              scale={Math.round(
                groupScale * normalizeWidgetScale(member.scale ?? widget.scale)
              )}
            />
          </div>
        )
      )}
    </div>
  );
});
WidgetGroup.displayName = 'WidgetGroup';
