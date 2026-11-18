import { memo, useMemo } from 'react';
import {
  OverlayHiddenContext,
  useActiveSimulator,
  useDashboard,
  useDrivingState,
  useHiddenWidgetIds,
  useOverlayHidden,
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
 *
 * The group's own rules hide it without unmounting it, as HideUIWrapper hides
 * the overlay: a widget in it goes on recording, as it does on the overlay
 * while its own rule hides it.
 */
export const WidgetGroup = memo(() => {
  const { currentDashboard } = useDashboard();
  const simulator = useActiveSimulator();
  const support = useSimWidgetSupport();
  const { running } = useRunningState();
  const hidden = useHiddenWidgetIds();
  const overlayHidden = useOverlayHidden();
  const groupScale = useWidgetScale();
  const { isDriving, isWatching } = useDrivingState();
  const config = findWidgetGroup(currentDashboard?.widgets)?.config as
    WidgetGroupWidgetSettings['config'] | undefined;
  const sessionVisible = useSessionVisibility(config?.sessionVisibility);
  const members = useMemo(
    () => resolveWidgetGroupMembers(currentDashboard, { support, simulator }),
    [currentDashboard, support, simulator]
  );
  const hiddenByRules =
    !sessionVisible ||
    (!!config?.showOnlyWhenOnTrack && !(isDriving || isWatching));

  return (
    <OverlayHiddenContext.Provider value={overlayHidden || hiddenByRules}>
      <div
        className={`relative h-full w-full overflow-hidden ${hiddenByRules ? 'invisible' : ''}`}
      >
        {members.map(({ member, widget }) =>
          hidden.has(widget.id) ? null : (
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
                running={running}
                host="widget-group"
                onOverlay
                scale={Math.round(
                  groupScale *
                    normalizeWidgetScale(member.scale ?? widget.scale)
                )}
              />
            </div>
          )
        )}
      </div>
    </OverlayHiddenContext.Provider>
  );
});
WidgetGroup.displayName = 'WidgetGroup';
